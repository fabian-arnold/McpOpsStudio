/* eslint-disable max-lines */
import { randomUUID } from "node:crypto";
import { Ajv } from "ajv";
import { z } from "zod";
import { prisma } from "@mcpops/db";
import { cronBindingSchema, cronBindingUpdateSchema } from "@mcpops/shared";
import { networkPolicyView } from "./api-operation-helpers.js";
import { stringList } from "./api-value-helpers.js";
import { snapshotHasEnabledCronBinding } from "./cron-snapshot.js";
import type { PlatformScope } from "./oauth.js";
import { scheduleQueue } from "./resources.js";

type Actor = {
  userId: string;
  role: string;
  scopes: PlatformScope[];
};

const ajv = new Ajv({ allErrors: true, strict: false });

const bindingReferenceSchema = z.object({ binding: z.string().min(1) }).strict();
const createSchema = z
  .object({ definition: cronBindingSchema, dryRun: z.boolean().default(true) })
  .strict();
const editSchema = z
  .object({
    binding: z.string().min(1),
    changes: cronBindingUpdateSchema,
    dryRun: z.boolean().default(true),
  })
  .strict();
const mutationSchema = bindingReferenceSchema.extend({
  dryRun: z.boolean().default(true),
});
const runsSchema = bindingReferenceSchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const cronToolNames = new Set([
  "cron_bindings_list",
  "cron_binding_get",
  "cron_binding_create",
  "cron_binding_edit",
  "cron_binding_delete",
  "cron_binding_run",
  "cron_binding_runs",
]);

export const cronTools = [
  platformTool(
    "cron_bindings_list",
    "List environment-scoped cron Function bindings and active scheduler state.",
    {},
    [],
    true,
  ),
  platformTool(
    "cron_binding_get",
    "Inspect one cron binding, its safe network policy, and activation state.",
    { binding: stringField("Cron binding ID or unambiguous name") },
    ["binding"],
    true,
  ),
  platformTool(
    "cron_binding_create",
    "Preview or create a validated five-field cron Function binding.",
    {
      definition: cronDefinitionField(false),
      dryRun: booleanField("Preview without saving", true),
    },
    ["definition"],
    false,
  ),
  platformTool(
    "cron_binding_edit",
    "Preview or edit a cron binding; deployment is required before changes become active.",
    {
      binding: stringField("Cron binding ID or unambiguous name"),
      changes: cronDefinitionField(true),
      dryRun: booleanField("Preview without saving", true),
    },
    ["binding", "changes"],
    false,
  ),
  platformTool(
    "cron_binding_delete",
    "Preview or soft-delete a cron binding; deployment removes its active scheduler.",
    {
      binding: stringField("Cron binding ID or unambiguous name"),
      dryRun: booleanField("Preview without deleting", true),
    },
    ["binding"],
    false,
  ),
  platformTool(
    "cron_binding_run",
    "Preview or queue a manual run from the active immutable schedule artifact.",
    {
      binding: stringField("Cron binding ID or unambiguous name"),
      dryRun: booleanField("Preview without queueing", true),
    },
    ["binding"],
    false,
  ),
  platformTool(
    "cron_binding_runs",
    "List durable scheduled, manual, skipped, missed, successful, and failed runs.",
    {
      binding: stringField("Cron binding ID or unambiguous name"),
      limit: numberField("Maximum results, 1-200"),
    },
    ["binding"],
    true,
  ),
];

export async function callCronTool(
  name: string,
  projectId: string,
  actor: Actor,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (name === "cron_bindings_list") return listBindings(projectId);
  if (name === "cron_binding_get") {
    const input = bindingReferenceSchema.parse(args);
    const binding = await findBinding(projectId, input.binding);
    return output(binding.name, { binding: await bindingView(binding) });
  }
  if (name === "cron_binding_create") return createBinding(projectId, actor, args);
  if (name === "cron_binding_edit") return editBinding(projectId, actor, args);
  if (name === "cron_binding_delete") return deleteBinding(projectId, actor, args);
  if (name === "cron_binding_run") return runBinding(projectId, actor, args);
  if (name === "cron_binding_runs") return listRuns(projectId, args);
  throw toolError("UNKNOWN_TOOL", `Unknown cron tool: ${name}`);
}

async function listBindings(projectId: string) {
  const bindings = await prisma.cronBinding.findMany({
    where: { projectId, deletedAt: null },
    include: { environment: true, function: true, networkPolicy: true },
    orderBy: [{ environment: { slug: "asc" } }, { name: "asc" }],
  });
  const schedulerState = await loadSchedulerState();
  const activeIds = await loadActiveBindingIds(projectId);
  return output(`${bindings.length} cron binding(s)`, {
    bindings: bindings.map((binding) =>
      bindingViewSync(binding, schedulerState.schedulers, activeIds),
    ),
    schedulerStatus: schedulerState.status,
  });
}

async function createBinding(
  projectId: string,
  actor: Actor,
  args: Record<string, unknown>,
) {
  requireScope(actor, "mcpops:write");
  requireRole(actor, ["owner", "admin", "developer"]);
  const input = createSchema.parse(args);
  const refs = await validateDefinition(projectId, input.definition);
  await ensureUniqueName(
    projectId,
    input.definition.environmentId,
    input.definition.name,
  );
  if (input.dryRun)
    return preview("Cron binding create preview", {
      definition: input.definition,
      environment: safeReference(refs.environment),
      function: safeReference(refs.fn),
    });
  const created = await prisma.$transaction(async (tx) => {
    const binding = await tx.cronBinding.create({
      data: {
        projectId,
        environmentId: input.definition.environmentId,
        functionId: input.definition.functionId,
        name: input.definition.name,
        expression: input.definition.expression,
        timezone: input.definition.timezone,
        enabled: input.definition.enabled,
        serviceSubject: input.definition.serviceSubject,
        permissionGrants: input.definition.permissionGrants,
      },
    });
    await tx.networkPolicy.create({
      data: {
        projectId,
        cronBindingId: binding.id,
        ...input.definition.networkPolicy,
      },
    });
    await tx.auditEvent.create({
      data: audit(actor, projectId, binding.environmentId, binding.id, {
        action: "created",
        metadata: {
          name: binding.name,
          functionId: binding.functionId,
          source: "platform_mcp",
        },
      }) as never,
    });
    return binding;
  });
  return {
    ...output(`Created ${created.name}`, {
      binding: await bindingView(await findBinding(projectId, created.id)),
    }),
    dryRun: false,
  };
}

async function editBinding(
  projectId: string,
  actor: Actor,
  args: Record<string, unknown>,
) {
  requireScope(actor, "mcpops:write");
  requireRole(actor, ["owner", "admin", "developer"]);
  const input = editSchema.parse(args);
  const current = await findBinding(projectId, input.binding);
  const definition = {
    environmentId: input.changes.environmentId ?? current.environmentId,
    functionId: input.changes.functionId ?? current.functionId,
    name: input.changes.name ?? current.name,
    expression: input.changes.expression ?? current.expression,
    timezone: input.changes.timezone ?? current.timezone,
    enabled: input.changes.enabled ?? current.enabled,
    serviceSubject: input.changes.serviceSubject ?? current.serviceSubject,
    permissionGrants:
      input.changes.permissionGrants ?? stringList(current.permissionGrants),
    networkPolicy:
      input.changes.networkPolicy ??
      networkPolicyView(current.networkPolicy).nextSnapshotPolicy,
  };
  await validateDefinition(projectId, definition);
  await ensureUniqueName(
    projectId,
    definition.environmentId,
    definition.name,
    current.id,
  );
  if (input.dryRun)
    return preview("Cron binding edit preview", {
      bindingId: current.id,
      changes: input.changes,
      resultingDefinition: definition,
    });
  await prisma.$transaction(async (tx) => {
    await tx.cronBinding.update({
      where: { id: current.id },
      data: {
        environmentId: definition.environmentId,
        functionId: definition.functionId,
        name: definition.name,
        expression: definition.expression,
        timezone: definition.timezone,
        enabled: definition.enabled,
        serviceSubject: definition.serviceSubject,
        permissionGrants: definition.permissionGrants,
      },
    });
    await tx.networkPolicy.upsert({
      where: { cronBindingId: current.id },
      create: { projectId, cronBindingId: current.id, ...definition.networkPolicy },
      update: definition.networkPolicy,
    });
    await tx.auditEvent.create({
      data: audit(actor, projectId, definition.environmentId, current.id, {
        action: "updated",
        metadata: {
          name: definition.name,
          functionId: definition.functionId,
          source: "platform_mcp",
        },
      }) as never,
    });
  });
  return {
    ...output(`Updated ${definition.name}`, {
      binding: await bindingView(await findBinding(projectId, current.id)),
    }),
    dryRun: false,
  };
}

async function deleteBinding(
  projectId: string,
  actor: Actor,
  args: Record<string, unknown>,
) {
  requireScope(actor, "mcpops:write");
  requireRole(actor, ["owner", "admin", "developer"]);
  const input = mutationSchema.parse(args);
  const binding = await findBinding(projectId, input.binding);
  if (input.dryRun)
    return preview("Cron binding delete preview", {
      binding: bindingViewSync(binding),
      effect: "The draft is soft-deleted; deploy to remove its active scheduler.",
    });
  await prisma.$transaction([
    prisma.cronBinding.update({
      where: { id: binding.id },
      data: { enabled: false, deletedAt: new Date() },
    }),
    prisma.auditEvent.create({
      data: audit(actor, projectId, binding.environmentId, binding.id, {
        action: "deleted",
        metadata: { name: binding.name, source: "platform_mcp" },
      }) as never,
    }),
  ]);
  return {
    ...output(`Deleted ${binding.name}`, { bindingId: binding.id }),
    dryRun: false,
  };
}

async function runBinding(
  projectId: string,
  actor: Actor,
  args: Record<string, unknown>,
) {
  requireScope(actor, "mcpops:deploy");
  requireRole(actor, ["owner", "admin", "operator"]);
  const input = mutationSchema.parse(args);
  const binding = await findBinding(projectId, input.binding);
  const active = await activeSchedule(projectId, binding.environmentId, binding.id);
  if (input.dryRun)
    return preview("Cron binding manual-run preview", {
      bindingId: binding.id,
      scheduleDeploymentId: active.id,
      input: {},
      serviceSubject: binding.serviceSubject,
      permissionGrants: stringList(binding.permissionGrants),
    });
  const scheduledAt = new Date();
  const requestId = randomUUID();
  await scheduleQueue.add(
    "cron-run",
    {
      bindingId: binding.id,
      scheduleDeploymentId: active.id,
      scheduledAt: scheduledAt.toISOString(),
      origin: "manual",
      requestId,
    },
    {
      jobId: `manual-${requestId}`,
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  );
  await prisma.auditEvent.create({
    data: audit(actor, projectId, binding.environmentId, binding.id, {
      action: "run_requested",
      metadata: {
        requestId,
        scheduleDeploymentId: active.id,
        source: "platform_mcp",
      },
    }) as never,
  });
  return {
    ...output(`Queued manual run for ${binding.name}`, {
      bindingId: binding.id,
      scheduleDeploymentId: active.id,
      requestId,
      scheduledAt,
    }),
    dryRun: false,
  };
}

async function listRuns(projectId: string, args: Record<string, unknown>) {
  const input = runsSchema.parse(args);
  const binding = await findBinding(projectId, input.binding);
  const runs = await prisma.scheduledRun.findMany({
    where: { projectId, cronBindingId: binding.id },
    include: { execution: { select: { id: true, status: true, durationMs: true } } },
    orderBy: { createdAt: "desc" },
    take: input.limit,
  });
  return output(`${runs.length} run(s) for ${binding.name}`, {
    binding: { id: binding.id, name: binding.name },
    runs,
  });
}

async function validateDefinition(
  projectId: string,
  input: { environmentId: string; functionId: string; permissionGrants: string[] },
) {
  const [environment, fn] = await Promise.all([
    prisma.environment.findFirst({ where: { id: input.environmentId, projectId } }),
    prisma.function.findFirst({ where: { id: input.functionId, projectId } }),
  ]);
  if (!environment || !fn)
    throw toolError(
      "INVALID_CRON_REFERENCE",
      "Cron environment and Function must belong to the selected project",
    );
  const missing = stringList(fn.requiredPermissions).filter(
    (permission) => !input.permissionGrants.includes(permission),
  );
  if (missing.length)
    throw toolError(
      "INSUFFICIENT_SERVICE_PERMISSIONS",
      `Service permissions are missing: ${missing.join(", ")}`,
    );
  if (!ajv.compile(fn.inputSchema as object)({}))
    throw toolError(
      "CRON_INPUT_SCHEMA_INCOMPATIBLE",
      "The Function input schema must accept an empty object for cron invocation",
    );
  return { environment, fn };
}

async function ensureUniqueName(
  projectId: string,
  environmentId: string,
  name: string,
  excludeId?: string,
) {
  const conflict = await prisma.cronBinding.findFirst({
    where: {
      projectId,
      environmentId,
      name,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (conflict)
    throw toolError(
      "CRON_BINDING_NAME_CONFLICT",
      "A cron binding with this name already exists in the environment",
    );
}

async function findBinding(projectId: string, identifier: string) {
  const matches = await prisma.cronBinding.findMany({
    where: {
      projectId,
      deletedAt: null,
      OR: [{ id: identifier }, { name: identifier }],
    },
    include: { environment: true, function: true, networkPolicy: true },
    take: 2,
  });
  if (!matches.length) throw toolError("NOT_FOUND", "Cron binding not found");
  if (matches.length > 1)
    throw toolError(
      "AMBIGUOUS_CRON_BINDING",
      "Cron binding name is ambiguous across environments; use its ID",
    );
  return matches[0]!;
}

type LoadedBinding = Awaited<ReturnType<typeof findBinding>>;

async function bindingView(binding: LoadedBinding) {
  const schedulerState = await loadSchedulerState();
  const activeIds = await loadActiveBindingIds(binding.projectId);
  return bindingViewSync(binding, schedulerState.schedulers, activeIds);
}

function bindingViewSync(
  binding: LoadedBinding,
  schedulers?: Map<string, number | null>,
  activeIds?: Set<string>,
) {
  return {
    id: binding.id,
    projectId: binding.projectId,
    environmentId: binding.environmentId,
    functionId: binding.functionId,
    name: binding.name,
    expression: binding.expression,
    timezone: binding.timezone,
    enabled: binding.enabled,
    serviceSubject: binding.serviceSubject,
    permissionGrants: stringList(binding.permissionGrants),
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
    environment: safeReference(binding.environment),
    function: {
      id: binding.function.id,
      name: binding.function.name,
      slug: binding.function.slug,
      requiredPermissions: stringList(binding.function.requiredPermissions),
    },
    networkPolicy: networkPolicyView(binding.networkPolicy),
    activation: activeIds?.has(binding.id) ? "active" : "draft",
    scheduler: schedulers
      ? {
          status: "available",
          nextRunAt:
            schedulers.get(`cron-${binding.environmentId}-${binding.id}`) ?? null,
        }
      : { status: "unavailable", nextRunAt: null },
  };
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

async function loadActiveBindingIds(projectId: string) {
  const deployments = await prisma.scheduleDeployment.findMany({
    where: {
      projectId,
      status: "active",
      projectDeployment: { activeForEnvironment: { isNot: null } },
    },
    select: { snapshot: true },
  });
  const ids = new Set<string>();
  for (const deployment of deployments) collectBindingIds(deployment.snapshot, ids);
  return ids;
}

function collectBindingIds(snapshot: unknown, ids: Set<string>) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return;
  const slices = (snapshot as { slices?: unknown }).slices;
  if (!Array.isArray(slices)) return;
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

async function activeSchedule(
  projectId: string,
  environmentId: string,
  bindingId: string,
) {
  const active = await prisma.scheduleDeployment.findFirst({
    where: {
      projectId,
      environmentId,
      projectDeployment: { activeForEnvironment: { isNot: null } },
    },
    select: { id: true, snapshot: true },
  });
  if (!active || !snapshotHasEnabledCronBinding(active.snapshot, bindingId))
    throw toolError(
      "CRON_BINDING_NOT_ACTIVE",
      "Deploy this cron binding before running it",
    );
  return active;
}

function audit(
  actor: Actor,
  projectId: string,
  environmentId: string,
  cronBindingId: string,
  event: { action: string; metadata: Record<string, unknown> },
) {
  return {
    projectId,
    environmentId,
    cronBindingId,
    actorType: "user" as const,
    actorId: actor.userId,
    action: `cron_binding.${event.action}`,
    targetType: "cron_binding",
    targetId: cronBindingId,
    metadata: event.metadata,
  };
}

function requireScope(actor: Actor, scope: PlatformScope) {
  if (!actor.scopes.includes(scope))
    throw toolError("INSUFFICIENT_SCOPE", `Required OAuth scope: ${scope}`);
}

function requireRole(actor: Actor, roles: string[]) {
  if (!roles.includes(actor.role))
    throw toolError("FORBIDDEN", "Your installation role cannot perform this action");
}

function safeReference(value: { id: string; name: string }) {
  return { id: value.id, name: value.name };
}

function preview(summary: string, data: unknown) {
  return { ...output(summary, data), dryRun: true };
}

function output(summary: string, data: unknown) {
  return { summary, data, nextActions: [] };
}

function toolError(code: string, message: string) {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

function platformTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  readOnly: boolean,
) {
  return {
    name,
    title: name
      .split("_")
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join(" "),
    description,
    inputSchema: {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: !readOnly,
      idempotentHint: readOnly,
    },
  };
}

function stringField(description: string) {
  return { type: "string", description };
}
function booleanField(description: string, defaultValue: boolean) {
  return { type: "boolean", description, default: defaultValue };
}
function numberField(description: string) {
  return { type: "number", description };
}

function cronDefinitionField(partial: boolean) {
  const fields = {
    environmentId: stringField("Environment UUID"),
    functionId: stringField("Project Function UUID"),
    name: stringField("Environment-scoped binding name"),
    expression: stringField("Exactly five cron fields, without seconds"),
    timezone: stringField("IANA timezone, for example Europe/Berlin"),
    enabled: { type: "boolean", description: "Whether deployment schedules ticks" },
    serviceSubject: stringField("Service caller subject exposed to the Function"),
    permissionGrants: {
      type: "array",
      description: "Explicit service permissions covering Function requirements",
      items: { type: "string" },
    },
    networkPolicy: networkPolicyField(),
  };
  return {
    type: "object",
    description: partial
      ? "Partial cron binding definition"
      : "Complete cron binding definition",
    properties: fields,
    ...(!partial
      ? {
          required: [
            "environmentId",
            "functionId",
            "name",
            "expression",
            "timezone",
            "serviceSubject",
          ],
        }
      : {}),
    additionalProperties: false,
  };
}

function networkPolicyField() {
  return {
    type: "object",
    description: "SSRF-safe outbound network policy",
    properties: {
      allowedHosts: stringArrayField("Allowed hostnames or wildcard hostnames"),
      allowedMethods: {
        type: "array",
        items: { enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      },
      allowedPorts: { type: "array", items: { type: "number" } },
      maxResponseBytes: numberField("Maximum upstream response bytes"),
      allowPrivateHosts: stringArrayField("Exact approved private hosts"),
      allowInsecureTlsHosts: stringArrayField("Exact approved insecure TLS hosts"),
    },
    required: ["allowedHosts", "allowedMethods", "allowedPorts", "maxResponseBytes"],
    additionalProperties: false,
  };
}

function stringArrayField(description: string) {
  return { type: "array", description, items: { type: "string" } };
}
