import { Ajv } from "ajv";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma, type Prisma } from "@mcpops/db";
import {
  functionQueryGrantCreateSchema,
  reviewedDatabaseConnectionCreateSchema,
  reviewedQueryDefinitionCreateSchema,
  reviewedQueryVersionCreateSchema,
  validateReviewedParameterSchema,
  validateReviewedReadQuery,
} from "@mcpops/shared";
import { requireRole, type PlatformSession } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const listQuerySchema = z.object({
  environmentId: z.string().uuid().optional(),
  connectionId: z.string().uuid().optional(),
}).strict();

export async function registerReviewedDatabaseRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/database/connections", async (request) => {
    const session = admin(request);
    const { environmentId } = parse(listQuerySchema.omit({ connectionId: true }), request.query);
    const rows = await prisma.databaseConnection.findMany({
      where: { projectId: session.projectId, ...(environmentId ? { environmentId } : {}) },
      include: { environment: { select: { id: true, name: true, slug: true } }, secret: { select: { id: true, name: true } }, _count: { select: { queryDefinitions: true } } },
      orderBy: [{ environment: { name: "asc" } }, { name: "asc" }],
    });
    return { connections: rows.map(connectionView) };
  });

  app.post("/api/database/connections", async (request, reply) => {
    const session = admin(request);
    const input = parse(reviewedDatabaseConnectionCreateSchema, request.body);
    const [environment, secret] = await Promise.all([
      prisma.environment.findFirst({ where: { id: input.environmentId, projectId: session.projectId }, select: { id: true, name: true, slug: true } }),
      prisma.secret.findFirst({ where: { id: input.secretId, projectId: session.projectId, environmentId: input.environmentId }, select: { id: true, name: true } }),
    ]);
    if (!environment || !secret) return notFound(reply, request, "Environment or connection secret not found");
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.databaseConnection.create({ data: { projectId: session.projectId, ...input } });
      await tx.auditEvent.create({ data: { projectId: session.projectId, environmentId: input.environmentId, actorType: "user", actorId: session.userId, action: "database_connection.created", targetType: "database_connection", targetId: row.id, metadata: { name: row.name, secretId: row.secretId } } });
      return row;
    });
    return reply.status(201).send(connectionView({ ...created, environment, secret, _count: { queryDefinitions: 0 } }));
  });

  app.post("/api/database/connections/:connectionId/disable", async (request, reply) => {
    const session = admin(request);
    const { connectionId } = request.params as { connectionId: string };
    const existing = await ownedConnection(session, connectionId);
    if (!existing) return notFound(reply, request, "Database connection not found");
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.databaseConnection.update({ where: { id: existing.id }, data: { enabled: false }, include: { environment: { select: { id: true, name: true, slug: true } }, secret: { select: { id: true, name: true } }, _count: { select: { queryDefinitions: true } } } });
      await tx.auditEvent.create({ data: { projectId: session.projectId, environmentId: existing.environmentId, actorType: "user", actorId: session.userId, action: "database_connection.disabled", targetType: "database_connection", targetId: existing.id, metadata: { name: existing.name } } });
      return updated;
    });
    return connectionView(row);
  });

  app.get("/api/database/queries", async (request) => {
    const session = admin(request);
    const { environmentId, connectionId } = parse(listQuerySchema, request.query);
    const rows = await prisma.reviewedQueryDefinition.findMany({
      where: { projectId: session.projectId, ...(environmentId ? { environmentId } : {}), ...(connectionId ? { connectionId } : {}) },
      include: queryDefinitionInclude,
      orderBy: [{ name: "asc" }],
    });
    return { queries: rows.map(queryDefinitionView) };
  });

  app.post("/api/database/queries", async (request, reply) => {
    const session = admin(request);
    const input = parse(reviewedQueryDefinitionCreateSchema, request.body);
    validateVersionInput(input);
    const connection = await prisma.databaseConnection.findFirst({ where: { id: input.connectionId, projectId: session.projectId, environmentId: input.environmentId, enabled: true } });
    if (!connection) return notFound(reply, request, "Enabled database connection not found in this environment");
    const { environmentId, connectionId, queryId, name, description, ...versionInput } = input;
    const definition = await prisma.$transaction(async (tx) => {
      const created = await tx.reviewedQueryDefinition.create({ data: { projectId: session.projectId, environmentId, connectionId, queryId, name, description } });
      const version = await tx.reviewedQueryVersion.create({ data: { queryDefinitionId: created.id, version: 1, ...versionInput, createdByUserId: session.userId } as Prisma.ReviewedQueryVersionUncheckedCreateInput });
      await tx.auditEvent.create({ data: { projectId: session.projectId, environmentId, actorType: "user", actorId: session.userId, action: "reviewed_query.created", targetType: "reviewed_query_definition", targetId: created.id, metadata: auditQueryMetadata(created.queryId, version) } });
      return tx.reviewedQueryDefinition.findUniqueOrThrow({ where: { id: created.id }, include: queryDefinitionInclude });
    });
    return reply.status(201).send(queryDefinitionView(definition));
  });

  app.post("/api/database/queries/:queryDefinitionId/versions", async (request, reply) => {
    const session = admin(request);
    const { queryDefinitionId } = request.params as { queryDefinitionId: string };
    const input = parse(reviewedQueryVersionCreateSchema, request.body);
    validateVersionInput(input);
    const definition = await prisma.reviewedQueryDefinition.findFirst({ where: { id: queryDefinitionId, projectId: session.projectId }, include: { connection: true } });
    if (!definition) return notFound(reply, request, "Reviewed query definition not found");
    if (!definition.connection.enabled) throw failure(409, "DATABASE_CONNECTION_DISABLED", "Cannot create a query version for a disabled connection");
    const latest = await prisma.reviewedQueryVersion.aggregate({ where: { queryDefinitionId }, _max: { version: true } });
    const created = await prisma.$transaction(async (tx) => {
      const version = await tx.reviewedQueryVersion.create({ data: { queryDefinitionId, version: (latest._max.version ?? 0) + 1, ...input, createdByUserId: session.userId } as Prisma.ReviewedQueryVersionUncheckedCreateInput });
      await tx.auditEvent.create({ data: { projectId: session.projectId, environmentId: definition.environmentId, actorType: "user", actorId: session.userId, action: "reviewed_query.version_created", targetType: "reviewed_query_version", targetId: version.id, metadata: auditQueryMetadata(definition.queryId, version) } });
      return version;
    });
    return reply.status(201).send(queryVersionView(created));
  });

  app.post("/api/database/query-versions/:queryVersionId/disable", async (request, reply) => {
    const session = admin(request);
    const { queryVersionId } = request.params as { queryVersionId: string };
    const existing = await prisma.reviewedQueryVersion.findFirst({ where: { id: queryVersionId, queryDefinition: { projectId: session.projectId } }, include: { queryDefinition: true } });
    if (!existing) return notFound(reply, request, "Reviewed query version not found");
    const updated = await prisma.$transaction(async (tx) => {
      const version = await tx.reviewedQueryVersion.update({ where: { id: queryVersionId }, data: { enabled: false } });
      await tx.auditEvent.create({ data: { projectId: session.projectId, environmentId: existing.queryDefinition.environmentId, actorType: "user", actorId: session.userId, action: "reviewed_query.version_disabled", targetType: "reviewed_query_version", targetId: version.id, metadata: { queryId: existing.queryDefinition.queryId, version: existing.version } } });
      return version;
    });
    return queryVersionView(updated);
  });

  app.get("/api/functions/:functionId/database-query-grants", async (request, reply) => {
    const session = admin(request);
    const { functionId } = request.params as { functionId: string };
    const fn = await ownedFunction(session, functionId);
    if (!fn) return notFound(reply, request, "Function not found");
    const grants = await prisma.functionQueryGrant.findMany({ where: { functionId, enabled: true }, include: grantInclude, orderBy: { createdAt: "asc" } });
    return { grants: grants.map(grantView) };
  });

  app.post("/api/functions/:functionId/database-query-grants", async (request, reply) => {
    const session = admin(request);
    const { functionId } = request.params as { functionId: string };
    const { queryVersionId } = parse(functionQueryGrantCreateSchema, request.body);
    const [fn, version] = await Promise.all([
      ownedFunction(session, functionId),
      prisma.reviewedQueryVersion.findFirst({ where: { id: queryVersionId, enabled: true, queryDefinition: { projectId: session.projectId } }, include: { queryDefinition: { include: { connection: true } } } }),
    ]);
    if (!fn || !version) return notFound(reply, request, "Function or enabled reviewed query version not found");
    if (!version.queryDefinition.connection.enabled) throw failure(409, "QUERY_CONNECTION_DISABLED", "The reviewed query connection is disabled");
    const grant = await prisma.$transaction(async (tx) => {
      const row = await tx.functionQueryGrant.upsert({
        where: { functionId_queryDefinitionId: { functionId, queryDefinitionId: version.queryDefinitionId } },
        create: { functionId, queryDefinitionId: version.queryDefinitionId, queryVersionId, enabled: true },
        update: { queryVersionId, enabled: true },
      });
      await tx.auditEvent.create({ data: { projectId: session.projectId, environmentId: version.queryDefinition.environmentId, functionId, actorType: "user", actorId: session.userId, action: "reviewed_query.granted", targetType: "function_query_grant", targetId: row.id, metadata: { queryId: version.queryDefinition.queryId, queryVersionId, version: version.version, connectionId: version.queryDefinition.connectionId } } });
      return tx.functionQueryGrant.findUniqueOrThrow({ where: { id: row.id }, include: grantInclude });
    });
    return reply.status(201).send(grantView(grant));
  });

  app.delete("/api/functions/:functionId/database-query-grants/:grantId", async (request, reply) => {
    const session = admin(request);
    const { functionId, grantId } = request.params as { functionId: string; grantId: string };
    const [fn, grant] = await Promise.all([
      ownedFunction(session, functionId),
      prisma.functionQueryGrant.findFirst({ where: { id: grantId, functionId, function: { projectId: session.projectId } }, include: { queryDefinition: true, queryVersion: true } }),
    ]);
    if (!fn || !grant) return notFound(reply, request, "Function query grant not found");
    await prisma.$transaction([
      prisma.functionQueryGrant.update({ where: { id: grantId }, data: { enabled: false } }),
      prisma.auditEvent.create({ data: { projectId: session.projectId, environmentId: grant.queryDefinition.environmentId, functionId, actorType: "user", actorId: session.userId, action: "reviewed_query.revoked", targetType: "function_query_grant", targetId: grantId, metadata: { queryId: grant.queryDefinition.queryId, queryVersionId: grant.queryVersionId, version: grant.queryVersion.version } } }),
    ]);
    return reply.status(204).send();
  });
}

const queryDefinitionInclude = {
  connection: { select: { id: true, name: true, enabled: true } },
  versions: { orderBy: { version: "desc" as const } },
  _count: { select: { grants: { where: { enabled: true } } } },
};
const grantInclude = {
  queryDefinition: { include: { connection: { select: { id: true, name: true, enabled: true } } } },
  queryVersion: true,
};

function admin(request: FastifyRequest): PlatformSession {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin"]);
  return session;
}

async function ownedConnection(session: PlatformSession, id: string) {
  return prisma.databaseConnection.findFirst({ where: { id, projectId: session.projectId } });
}

async function ownedFunction(session: PlatformSession, functionId: string) {
  return prisma.function.findFirst({ where: { id: functionId, projectId: session.projectId } });
}

function validateVersionInput(input: { sql: string; parameterOrder: string[]; parameterSchema: Record<string, unknown>; resultSchema?: Record<string, unknown> }): void {
  try {
    validateReviewedReadQuery(input.sql, input.parameterOrder);
    validateReviewedParameterSchema(input.parameterOrder, input.parameterSchema);
    ajv.compile(input.parameterSchema);
    if (input.resultSchema) ajv.compile(input.resultSchema);
  } catch (error) {
    throw failure(400, "INVALID_REVIEWED_QUERY", error instanceof Error ? error.message : "Reviewed query validation failed");
  }
}

function connectionView(row: { id: string; name: string; description: string; enabled: boolean; createdAt: Date; updatedAt: Date; environment: { id: string; name: string; slug: string }; secret: { id: string; name: string }; _count: { queryDefinitions: number } }) {
  return { id: row.id, environment: row.environment, secret: row.secret, name: row.name, description: row.description, enabled: row.enabled, createdAt: row.createdAt, updatedAt: row.updatedAt, queryCount: row._count.queryDefinitions };
}

function queryVersionView(row: { id: string; version: number; sql: string; parameterOrder: unknown; parameterSchema: unknown; resultSchema: unknown; timeoutMs: number; maxRows: number; maxBytes: number; enabled: boolean; createdAt: Date }) {
  return { id: row.id, version: row.version, sql: row.sql, parameterOrder: row.parameterOrder, parameterSchema: row.parameterSchema, ...(row.resultSchema ? { resultSchema: row.resultSchema } : {}), timeoutMs: row.timeoutMs, maxRows: row.maxRows, maxBytes: row.maxBytes, enabled: row.enabled, createdAt: row.createdAt };
}

function queryDefinitionView(row: { id: string; environmentId: string; queryId: string; name: string; description: string; createdAt: Date; updatedAt: Date; connection: { id: string; name: string; enabled: boolean }; versions: Array<Parameters<typeof queryVersionView>[0]>; _count: { grants: number } }) {
  return { id: row.id, environmentId: row.environmentId, connection: row.connection, queryId: row.queryId, name: row.name, description: row.description, createdAt: row.createdAt, updatedAt: row.updatedAt, versions: row.versions.map(queryVersionView), grantCount: row._count.grants };
}

function grantView(row: { id: string; functionId: string; queryDefinitionId: string; queryVersionId: string; enabled: boolean; createdAt: Date; updatedAt: Date; queryDefinition: { queryId: string; name: string; connection: { id: string; name: string; enabled: boolean } }; queryVersion: { version: number; enabled: boolean } }) {
  return { id: row.id, functionId: row.functionId, queryDefinitionId: row.queryDefinitionId, queryVersionId: row.queryVersionId, enabled: row.enabled, createdAt: row.createdAt, updatedAt: row.updatedAt, query: { queryId: row.queryDefinition.queryId, name: row.queryDefinition.name, version: row.queryVersion.version, connectionName: row.queryDefinition.connection.name, connection: row.queryDefinition.connection, versionEnabled: row.queryVersion.enabled } };
}

function auditQueryMetadata(queryId: string, version: { id: string; version: number; timeoutMs: number; maxRows: number; maxBytes: number; enabled: boolean }) {
  return { queryId, queryVersionId: version.id, version: version.version, timeoutMs: version.timeoutMs, maxRows: version.maxRows, maxBytes: version.maxBytes, enabled: version.enabled };
}

function notFound(reply: FastifyReply, request: FastifyRequest, message: string) {
  return reply.status(404).send({ error: { code: "NOT_FOUND", message, requestId: requestId(request) } });
}

function failure(statusCode: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}
