import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "@mcpops/db";
import { redactSensitive } from "@mcpops/shared";
import { parse, requestId, sessionContext } from "./helpers.js";
import {
  auditListQuerySchema,
  csv,
  executionListQuerySchema,
  runtimeLogListQuerySchema,
} from "./listing.js";

type ExecutionViewRow = {
  id: string;
  endpointId: string;
  functionId: string;
  createdAt: Date;
  requestId: string;
  correlationId: string | null;
  parentExecutionId: string | null;
  rootExecutionId: string | null;
  invocationSource: string;
  status: string;
  durationMs: number;
  callerIdentity: unknown;
  input: unknown;
  output: unknown;
  error: unknown;
  function?: { name: string };
  deployment?: { version: number };
  functionVersion?: { version: number };
  mcpToolBinding?: { toolName: string } | null;
  httpRouteBinding?: { method: string; path: string } | null;
};

type AuditViewRow = {
  id: string;
  createdAt: Date;
  action: string;
  actorType: string;
  actorId: string | null;
  targetType: string;
  targetId: string | null;
};

export function registerObservabilityRoutes(app: FastifyInstance): void {
  registerLogRoutes(app);
  registerExecutionRoutes(app);
  registerAuditRoutes(app);
}

function registerLogRoutes(app: FastifyInstance): void {
  app.get("/api/logs", async (request, reply) => {
    const session = sessionContext(request);
    const query = parse(runtimeLogListQuerySchema, request.query);
    const where = {
      projectId: session.projectId,
      ...(query.environmentId ? { environmentId: query.environmentId } : {}),
      ...(query.endpointId ? { endpointId: query.endpointId } : {}),
      ...(query.functionId ? { functionId: query.functionId } : {}),
      ...(query.level ? { level: query.level } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(query.correlationId ? { correlationId: query.correlationId } : {}),
      ...(query.q
        ? {
            OR: [
              { message: { contains: query.q, mode: "insensitive" as const } },
              { requestId: { contains: query.q, mode: "insensitive" as const } },
              {
                correlationId: {
                  contains: query.q,
                  mode: "insensitive" as const,
                },
              },
              {
                function: {
                  name: { contains: query.q, mode: "insensitive" as const },
                },
              },
              {
                function: {
                  slug: { contains: query.q, mode: "insensitive" as const },
                },
              },
              {
                endpoint: {
                  name: { contains: query.q, mode: "insensitive" as const },
                },
              },
            ],
          }
        : {}),
      ...dateWhere(query.from, query.to),
    };
    const [rows, grouped] = await Promise.all([
      prisma.runtimeLog.findMany({
        where,
        include: {
          environment: { select: { id: true, name: true, slug: true } },
          endpoint: { select: { id: true, name: true, slug: true, kind: true } },
          function: { select: { id: true, name: true, slug: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      prisma.runtimeLog.groupBy({
        by: ["level"],
        where,
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
    ]);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const items = redactSensitive(
      page.map((row) => ({
        id: row.id,
        timestamp: row.createdAt,
        level: row.level,
        message: row.message,
        metadata: row.metadata,
        sizeBytes: row.sizeBytes,
        requestId: row.requestId,
        correlationId: row.correlationId,
        executionId: row.executionId,
        deploymentId: row.deploymentId,
        environment: row.environment,
        endpoint: row.endpoint,
        function: row.function,
      })),
    );
    if (query.format === "csv")
      return replyCsv(
        reply,
        csv(items as Array<Record<string, unknown>>, [
          "timestamp",
          "level",
          "message",
          "metadata",
          "requestId",
          "correlationId",
          "executionId",
          "environment",
          "endpoint",
          "function",
        ]),
        datedFilename("logs"),
      );
    return {
      items,
      nextCursor: hasMore ? page.at(-1)?.id : undefined,
      summary: {
        count: grouped.reduce((total, row) => total + row._count._all, 0),
        sizeBytes: grouped.reduce((total, row) => total + (row._sum.sizeBytes ?? 0), 0),
        levels: Object.fromEntries(grouped.map((row) => [row.level, row._count._all])),
      },
    };
  });
}

function registerExecutionRoutes(app: FastifyInstance): void {
  app.get("/api/executions", async (request, reply) => {
    const session = sessionContext(request);
    const query = parse(executionListQuerySchema, request.query);
    const rows = await prisma.functionExecution.findMany({
      where: {
        projectId: session.projectId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.endpointId ? { endpointId: query.endpointId } : {}),
        ...(query.functionId ? { functionId: query.functionId } : {}),
        ...(query.toolBindingId ? { mcpToolBindingId: query.toolBindingId } : {}),
        ...(query.httpRouteBindingId
          ? { httpRouteBindingId: query.httpRouteBindingId }
          : {}),
        ...(query.requestId ? { requestId: query.requestId } : {}),
        ...(query.source ? { invocationSource: query.source } : {}),
        ...(query.callerSubject
          ? { callerIdentity: { path: ["subject"], equals: query.callerSubject } }
          : {}),
        ...dateWhere(query.from, query.to),
      } as never,
      include: {
        function: { select: { name: true } },
        endpoint: { select: { name: true } },
        deployment: { select: { version: true } },
        functionVersion: { select: { version: true } },
        mcpToolBinding: true,
        httpRouteBinding: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const items = redactSensitive(page.map(executionView));
    if (query.format === "csv")
      return replyCsv(
        reply,
        csv(items as Array<Record<string, unknown>>, [
          "id",
          "createdAt",
          "requestId",
          "correlationId",
          "invocationSource",
          "endpointId",
          "functionName",
          "binding",
          "caller",
          "status",
          "durationMs",
          "functionVersion",
          "deploymentVersion",
          "input",
          "output",
          "error",
        ]),
        datedFilename("executions"),
      );
    return { items, nextCursor: hasMore ? page.at(-1)?.id : undefined };
  });

  app.get("/api/executions/:id", async (request, reply) => {
    const session = sessionContext(request);
    const { id } = request.params as { id: string };
    const row = await prisma.functionExecution.findFirst({
      where: { id, projectId: session.projectId },
      include: {
        function: { select: { name: true } },
        deployment: { select: { version: true } },
        functionVersion: { select: { version: true } },
        mcpToolBinding: { select: { toolName: true } },
        httpRouteBinding: { select: { method: true, path: true } },
      },
    });
    return row
      ? redactSensitive(executionView(row))
      : reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Execution not found",
            requestId: requestId(request),
          },
        });
  });
}

function registerAuditRoutes(app: FastifyInstance): void {
  app.get("/api/audit-events", async (request, reply) => {
    const session = sessionContext(request);
    const query = parse(auditListQuerySchema, request.query);
    const rows = await prisma.auditEvent.findMany({
      where: {
        projectId: session.projectId,
        ...(query.endpointId ? { endpointId: query.endpointId } : {}),
        ...(query.functionId ? { functionId: query.functionId } : {}),
        ...(query.action
          ? { action: { contains: query.action, mode: "insensitive" } }
          : {}),
        ...(query.actorType ? { actorType: query.actorType } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...dateWhere(query.from, query.to),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const items = redactSensitive(page.map(auditView));
    if (query.format === "csv")
      return replyCsv(
        reply,
        csv(items as Array<Record<string, unknown>>, [
          "id",
          "createdAt",
          "action",
          "actorType",
          "actorId",
          "targetType",
          "targetId",
          "endpointId",
          "functionId",
          "metadata",
        ]),
        datedFilename("audit"),
      );
    return { items, nextCursor: hasMore ? page.at(-1)?.id : undefined };
  });
}

export function executionView(row: ExecutionViewRow) {
  const callerIdentity = isRecord(row.callerIdentity) ? row.callerIdentity : {};
  return {
    id: row.id,
    endpointId: row.endpointId,
    functionId: row.functionId,
    createdAt: row.createdAt,
    requestId: row.requestId,
    correlationId: row.correlationId ?? undefined,
    parentExecutionId: row.parentExecutionId ?? undefined,
    rootExecutionId: row.rootExecutionId ?? row.id,
    invocationSource: row.invocationSource,
    functionName: row.function?.name ?? "Unknown function",
    binding:
      row.mcpToolBinding?.toolName ??
      (row.httpRouteBinding
        ? `${row.httpRouteBinding.method} ${row.httpRouteBinding.path}`
        : undefined),
    caller:
      typeof callerIdentity.subject === "string" ? callerIdentity.subject : undefined,
    callerIdentity,
    status: row.status,
    durationMs: row.durationMs,
    functionVersion: row.functionVersion?.version ?? 0,
    deploymentVersion: row.deployment?.version ?? 0,
    input: row.input,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
  };
}

export function auditView(row: AuditViewRow) {
  return {
    ...row,
    actor: row.actorId ? `${row.actorType}:${row.actorId}` : row.actorType,
    targetId: row.targetId ?? undefined,
  };
}

export function dateWhere(from?: Date, to?: Date) {
  return from || to
    ? {
        createdAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      }
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function datedFilename(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
}

function replyCsv(reply: FastifyReply, content: string, filename: string) {
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename=${JSON.stringify(filename)}`)
    .send(content);
}
