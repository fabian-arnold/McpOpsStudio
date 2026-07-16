import { randomUUID } from "node:crypto";
import { Ajv } from "ajv";
import type { FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import {
  cronBindingSchema,
  cronBindingUpdateSchema,
  cronRunsQuerySchema,
} from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { snapshotHasEnabledCronBinding } from "./cron-snapshot.js";
import { parse, requestId, sessionContext } from "./helpers.js";
import { stringList } from "./api-value-helpers.js";
import { networkPolicyView } from "./api-operation-helpers.js";
import { scheduleQueue } from "./resources.js";

const ajv = new Ajv({ allErrors: true, strict: false });

export function cronSchedulerId(environmentId: string, bindingId: string): string {
  return `cron-${environmentId}-${bindingId}`;
}

export function bullCronPattern(expression: string): string {
  return `0 ${expression.trim()}`;
}

export async function registerCronBindingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/cron-bindings", async (request) => {
    const session = sessionContext(request);
    const bindings = await prisma.cronBinding.findMany({
      where: { projectId: session.projectId, deletedAt: null },
      include: { environment: true, function: true, networkPolicy: true },
      orderBy: [{ environment: { slug: "asc" } }, { name: "asc" }],
    });
    const [schedulerState, activeIds] = await Promise.all([
      loadSchedulerState(),
      loadActiveBindingIds(session.projectId),
    ]);
    return {
      items: bindings.map((binding) =>
        view(binding, schedulerState.schedulers, activeIds),
      ),
      schedulerStatus: schedulerState.status,
    };
  });

  app.post("/api/cron-bindings", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const input = parse(cronBindingSchema, request.body);
    const references = await validateReferences(session.projectId, input);
    const created = await prisma.$transaction(async (tx) => {
      const binding = await tx.cronBinding.create({
        data: {
          projectId: session.projectId,
          environmentId: input.environmentId,
          functionId: input.functionId,
          name: input.name,
          expression: input.expression,
          timezone: input.timezone,
          enabled: input.enabled,
          serviceSubject: input.serviceSubject,
          permissionGrants: input.permissionGrants,
        },
      });
      await tx.networkPolicy.create({
        data: {
          projectId: session.projectId,
          cronBindingId: binding.id,
          ...input.networkPolicy,
        },
      });
      await tx.auditEvent.create({
        data: audit(
          session,
          references.environment.id,
          binding.id,
          "cron_binding.created",
          {
            name: binding.name,
            functionId: binding.functionId,
          },
        ) as never,
      });
      return binding;
    });
    const loaded = await loadOwnedBinding(session.projectId, created.id);
    return reply.status(201).send(loaded ? view(loaded) : created);
  });

  app.get("/api/cron-bindings/:id", async (request, reply) => {
    const session = sessionContext(request);
    const { id } = request.params as { id: string };
    const binding = await loadOwnedBinding(session.projectId, id);
    if (!binding) return notFound(reply, requestId(request));
    const schedulerState = await loadSchedulerState();
    return view(
      binding,
      schedulerState.schedulers,
      await loadActiveBindingIds(session.projectId),
    );
  });

  app.patch("/api/cron-bindings/:id", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const { id } = request.params as { id: string };
    const current = await loadOwnedBinding(session.projectId, id);
    if (!current) return notFound(reply, requestId(request));
    const input = parse(cronBindingUpdateSchema, request.body);
    const merged = {
      environmentId: input.environmentId ?? current.environmentId,
      functionId: input.functionId ?? current.functionId,
      name: input.name ?? current.name,
      expression: input.expression ?? current.expression,
      timezone: input.timezone ?? current.timezone,
      enabled: input.enabled ?? current.enabled,
      serviceSubject: input.serviceSubject ?? current.serviceSubject,
      permissionGrants: input.permissionGrants ?? stringList(current.permissionGrants),
      networkPolicy:
        input.networkPolicy ??
        networkPolicyView(current.networkPolicy).nextSnapshotPolicy,
    };
    const references = await validateReferences(session.projectId, merged);
    await prisma.$transaction(async (tx) => {
      await tx.cronBinding.update({
        where: { id },
        data: {
          environmentId: merged.environmentId,
          functionId: merged.functionId,
          name: merged.name,
          expression: merged.expression,
          timezone: merged.timezone,
          enabled: merged.enabled,
          serviceSubject: merged.serviceSubject,
          permissionGrants: merged.permissionGrants,
        },
      });
      await tx.networkPolicy.upsert({
        where: { cronBindingId: id },
        create: {
          projectId: session.projectId,
          cronBindingId: id,
          ...merged.networkPolicy,
        },
        update: merged.networkPolicy,
      });
      await tx.auditEvent.create({
        data: audit(session, references.environment.id, id, "cron_binding.updated", {
          name: merged.name,
          functionId: merged.functionId,
        }) as never,
      });
    });
    const loaded = await loadOwnedBinding(session.projectId, id);
    return loaded ? view(loaded) : notFound(reply, requestId(request));
  });

  app.delete("/api/cron-bindings/:id", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const { id } = request.params as { id: string };
    const binding = await loadOwnedBinding(session.projectId, id);
    if (!binding) return notFound(reply, requestId(request));
    await prisma.$transaction([
      prisma.cronBinding.update({
        where: { id },
        data: { enabled: false, deletedAt: new Date() },
      }),
      prisma.auditEvent.create({
        data: audit(session, binding.environmentId, id, "cron_binding.deleted", {
          name: binding.name,
        }) as never,
      }),
    ]);
    return reply.status(204).send();
  });

  app.post("/api/cron-bindings/:id/run", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "operator"]);
    const { id } = request.params as { id: string };
    const binding = await loadOwnedBinding(session.projectId, id);
    if (!binding) return notFound(reply, requestId(request));
    const active = await prisma.scheduleDeployment.findFirst({
      where: {
        projectId: session.projectId,
        environmentId: binding.environmentId,
        projectDeployment: { activeForEnvironment: { isNot: null } },
      },
      select: { id: true, snapshot: true },
    });
    if (!active || !snapshotHasEnabledCronBinding(active.snapshot, id))
      return reply.status(409).send({
        error: {
          code: "CRON_BINDING_NOT_ACTIVE",
          message: "Deploy this cron binding before running it.",
          requestId: requestId(request),
        },
      });
    const scheduledAt = new Date();
    const runRequestId = randomUUID();
    await scheduleQueue.add(
      "cron-run",
      {
        bindingId: id,
        scheduleDeploymentId: active.id,
        scheduledAt: scheduledAt.toISOString(),
        origin: "manual",
        requestId: runRequestId,
      },
      {
        jobId: `manual-${runRequestId}`,
        attempts: 1,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
    await prisma.auditEvent.create({
      data: audit(session, binding.environmentId, id, "cron_binding.run_requested", {
        requestId: runRequestId,
        scheduleDeploymentId: active.id,
      }) as never,
    });
    return reply.status(202).send({ requestId: runRequestId, scheduledAt });
  });

  app.get("/api/cron-bindings/:id/runs", async (request, reply) => {
    const session = sessionContext(request);
    const { id } = request.params as { id: string };
    if (!(await loadOwnedBinding(session.projectId, id)))
      return notFound(reply, requestId(request));
    const { limit } = parse(cronRunsQuerySchema, request.query);
    return {
      items: await prisma.scheduledRun.findMany({
        where: { projectId: session.projectId, cronBindingId: id },
        include: {
          execution: { select: { id: true, status: true, durationMs: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    };
  });
}

async function validateReferences(
  projectId: string,
  input: { environmentId: string; functionId: string; permissionGrants: string[] },
) {
  const [environment, fn] = await Promise.all([
    prisma.environment.findFirst({ where: { id: input.environmentId, projectId } }),
    prisma.function.findFirst({ where: { id: input.functionId, projectId } }),
  ]);
  if (!environment || !fn)
    throw Object.assign(
      new Error("Cron environment and Function must belong to the selected project"),
      {
        statusCode: 400,
        code: "INVALID_CRON_REFERENCE",
      },
    );
  const missing = stringList(fn.requiredPermissions).filter(
    (permission) => !input.permissionGrants.includes(permission),
  );
  if (missing.length)
    throw Object.assign(
      new Error(`Service permissions are missing: ${missing.join(", ")}`),
      {
        statusCode: 400,
        code: "INSUFFICIENT_SERVICE_PERMISSIONS",
      },
    );
  if (!ajv.compile(fn.inputSchema as object)({}))
    throw Object.assign(
      new Error(
        "The Function input schema must accept an empty object for cron invocation",
      ),
      {
        statusCode: 400,
        code: "CRON_INPUT_SCHEMA_INCOMPATIBLE",
      },
    );
  return { environment, fn };
}

async function loadOwnedBinding(projectId: string, id: string) {
  return prisma.cronBinding.findFirst({
    where: { id, projectId, deletedAt: null },
    include: { environment: true, function: true, networkPolicy: true },
  });
}

function view(
  binding: NonNullable<Awaited<ReturnType<typeof loadOwnedBinding>>>,
  schedulers?: Map<string, number | null>,
  activeIds?: Set<string>,
) {
  return {
    ...binding,
    permissionGrants: stringList(binding.permissionGrants),
    networkPolicy: networkPolicyView(binding.networkPolicy),
    activation: activeIds?.has(binding.id) ? "active" : "draft",
    scheduler: schedulers
      ? {
          status: "available",
          nextRunAt:
            schedulers.get(cronSchedulerId(binding.environmentId, binding.id)) ?? null,
        }
      : { status: "unavailable", nextRunAt: null },
  };
}

async function loadActiveBindingIds(projectId: string): Promise<Set<string>> {
  const deployments = await prisma.scheduleDeployment.findMany({
    where: {
      projectId,
      status: "active",
      projectDeployment: { activeForEnvironment: { isNot: null } },
    },
    select: { snapshot: true },
  });
  const ids = new Set<string>();
  for (const deployment of deployments) {
    if (
      !deployment.snapshot ||
      typeof deployment.snapshot !== "object" ||
      Array.isArray(deployment.snapshot)
    )
      continue;
    const slices = (deployment.snapshot as { slices?: unknown }).slices;
    if (!Array.isArray(slices)) continue;
    for (const slice of slices) {
      if (!slice || typeof slice !== "object" || Array.isArray(slice)) continue;
      const bindings = (slice as { bindings?: unknown }).bindings;
      if (!Array.isArray(bindings)) continue;
      for (const binding of bindings)
        if (
          binding &&
          typeof binding === "object" &&
          !Array.isArray(binding) &&
          typeof (binding as { id?: unknown }).id === "string"
        )
          ids.add((binding as { id: string }).id);
    }
  }
  return ids;
}

async function loadSchedulerState(): Promise<{
  status: "available" | "unavailable";
  schedulers?: Map<string, number | null>;
}> {
  try {
    const rows = await scheduleQueue.getJobSchedulers(0, 1000, true);
    return {
      status: "available",
      schedulers: new Map(
        rows.map((row) => [row.key, typeof row.next === "number" ? row.next : null]),
      ),
    };
  } catch {
    return { status: "unavailable" };
  }
}

function audit(
  session: ReturnType<typeof sessionContext>,
  environmentId: string,
  cronBindingId: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  return {
    projectId: session.projectId,
    environmentId,
    cronBindingId,
    actorType: "user" as const,
    actorId: session.userId,
    action,
    targetType: "cron_binding",
    targetId: cronBindingId,
    metadata,
  };
}

function notFound(
  reply: { status(code: number): { send(value: unknown): unknown } },
  id: string,
) {
  return reply.status(404).send({
    error: { code: "NOT_FOUND", message: "Cron binding not found", requestId: id },
  });
}
