import { Ajv } from "ajv";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@mcpops/db";
import {
  validateReviewedParameterSchema,
  validateReviewedReadQuery,
} from "@mcpops/shared";
import { requireRole, type PlatformSession } from "./auth.js";
import { sessionContext, requestId } from "./helpers.js";

const ajv = new Ajv({ allErrors: true, strict: false });
export function admin(request: FastifyRequest): PlatformSession {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin"]);
  return session;
}

export async function ownedConnection(session: PlatformSession, id: string) {
  return prisma.databaseConnection.findFirst({
    where: { id, projectId: session.projectId },
  });
}

export async function ownedFunction(session: PlatformSession, functionId: string) {
  return prisma.function.findFirst({
    where: { id: functionId, projectId: session.projectId },
  });
}

export function validateVersionInput(input: {
  sql: string;
  parameterOrder: string[];
  parameterSchema: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
}): void {
  try {
    validateReviewedReadQuery(input.sql, input.parameterOrder);
    validateReviewedParameterSchema(input.parameterOrder, input.parameterSchema);
    ajv.compile(input.parameterSchema);
    if (input.resultSchema) ajv.compile(input.resultSchema);
  } catch (error) {
    throw failure(
      400,
      "INVALID_REVIEWED_QUERY",
      error instanceof Error ? error.message : "Reviewed query validation failed",
    );
  }
}

export function connectionView(row: {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  environment: { id: string; name: string; slug: string };
  secret: { id: string; name: string };
  _count: { queryDefinitions: number };
}) {
  return {
    id: row.id,
    environment: row.environment,
    secret: row.secret,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    queryCount: row._count.queryDefinitions,
  };
}

export function queryVersionView(row: {
  id: string;
  version: number;
  sql: string;
  parameterOrder: unknown;
  parameterSchema: unknown;
  resultSchema: unknown;
  timeoutMs: number;
  maxRows: number;
  maxBytes: number;
  enabled: boolean;
  createdAt: Date;
}) {
  return {
    id: row.id,
    version: row.version,
    sql: row.sql,
    parameterOrder: row.parameterOrder,
    parameterSchema: row.parameterSchema,
    ...(row.resultSchema ? { resultSchema: row.resultSchema } : {}),
    timeoutMs: row.timeoutMs,
    maxRows: row.maxRows,
    maxBytes: row.maxBytes,
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

export function queryDefinitionView(row: {
  id: string;
  environmentId: string;
  queryId: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  connection: { id: string; name: string; enabled: boolean };
  versions: Array<Parameters<typeof queryVersionView>[0]>;
  _count: { grants: number };
}) {
  return {
    id: row.id,
    environmentId: row.environmentId,
    connection: row.connection,
    queryId: row.queryId,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    versions: row.versions.map(queryVersionView),
    grantCount: row._count.grants,
  };
}

export function grantView(row: {
  id: string;
  functionId: string;
  queryDefinitionId: string;
  queryVersionId: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  queryDefinition: {
    queryId: string;
    name: string;
    connection: { id: string; name: string; enabled: boolean };
  };
  queryVersion: { version: number; enabled: boolean };
}) {
  return {
    id: row.id,
    functionId: row.functionId,
    queryDefinitionId: row.queryDefinitionId,
    queryVersionId: row.queryVersionId,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    query: {
      queryId: row.queryDefinition.queryId,
      name: row.queryDefinition.name,
      version: row.queryVersion.version,
      connectionName: row.queryDefinition.connection.name,
      connection: row.queryDefinition.connection,
      versionEnabled: row.queryVersion.enabled,
    },
  };
}

export function auditQueryMetadata(
  queryId: string,
  version: {
    id: string;
    version: number;
    timeoutMs: number;
    maxRows: number;
    maxBytes: number;
    enabled: boolean;
  },
) {
  return {
    queryId,
    queryVersionId: version.id,
    version: version.version,
    timeoutMs: version.timeoutMs,
    maxRows: version.maxRows,
    maxBytes: version.maxBytes,
    enabled: version.enabled,
  };
}

export function notFound(
  reply: FastifyReply,
  request: FastifyRequest,
  message: string,
) {
  return reply
    .status(404)
    .send({ error: { code: "NOT_FOUND", message, requestId: requestId(request) } });
}

export function failure(statusCode: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}
