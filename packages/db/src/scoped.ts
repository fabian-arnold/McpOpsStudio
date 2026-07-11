import type { Prisma, PrismaClient } from "@prisma/client";

export class ProjectScopeError extends Error {
  constructor() {
    super("The requested record is outside the authenticated project scope.");
    this.name = "ProjectScopeError";
  }
}

/**
 * Project scope is captured once from the authenticated session. Callers do
 * not get an unscoped `findUnique`, which makes accidental cross-tenant reads
 * materially harder in API handlers.
 */
export function withProjectScope(client: PrismaClient, projectId: string) {
  if (!projectId) throw new ProjectScopeError();

  return {
    projectId,
    endpoints: {
      list: (args: Omit<Prisma.RuntimeEndpointFindManyArgs, "where"> = {}) =>
        client.runtimeEndpoint.findMany({ ...args, where: { projectId } }),
      byId: (id: string, include?: Prisma.RuntimeEndpointInclude) =>
        client.runtimeEndpoint.findFirst({
          where: { id, projectId },
          ...(include ? { include } : {}),
        }),
      bySlug: (environmentId: string, slug: string, include?: Prisma.RuntimeEndpointInclude) =>
        client.runtimeEndpoint.findFirst({
          where: { projectId, environmentId, slug },
          ...(include ? { include } : {}),
        }),
    },
    functions: {
      listForEndpoint: (_endpointId: string) =>
        client.function.findMany({ where: { projectId }, orderBy: { name: "asc" } }),
      byId: (id: string) => client.function.findFirst({ where: { id, projectId } }),
    },
    environments: {
      list: () => client.environment.findMany({ where: { projectId }, orderBy: { name: "asc" } }),
    },
    executions: {
      list: (where: Omit<Prisma.FunctionExecutionWhereInput, "projectId"> = {}) =>
        client.functionExecution.findMany({
          where: { ...where, projectId },
          orderBy: { createdAt: "desc" },
        }),
      byId: (id: string) => client.functionExecution.findFirst({ where: { id, projectId } }),
    },
    auditEvents: {
      list: (where: Omit<Prisma.AuditEventWhereInput, "projectId"> = {}) =>
        client.auditEvent.findMany({
          where: { ...where, projectId },
          orderBy: { createdAt: "desc" },
        }),
    },
    secrets: {
      // Deliberately omit encryptedValue from control-plane list responses.
      listMetadata: () =>
        client.secret.findMany({
          where: { projectId },
          select: { id: true, environmentId: true, name: true, createdAt: true, updatedAt: true },
        }),
    },
  };
}

export async function assertProjectAccess(
  client: PrismaClient,
  projectId: string,
  endpointId: string,
): Promise<void> {
  const record = await client.runtimeEndpoint.findFirst({
    where: { id: endpointId, projectId },
    select: { id: true },
  });
  if (!record) throw new ProjectScopeError();
}
