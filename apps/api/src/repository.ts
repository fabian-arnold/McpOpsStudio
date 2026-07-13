import { prisma, type Prisma } from "@mcpops/db";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function endpointIdentifierWhere(
  identifier: string,
): { id: string } | { slug: string } {
  return uuidPattern.test(identifier)
    ? { id: identifier }
    : { slug: identifier };
}

export function functionIdentifierWhere(
  identifier: string,
): { id: string } | { OR: Array<{ slug: string } | { name: string }> } {
  return uuidPattern.test(identifier)
    ? { id: identifier }
    : { OR: [{ slug: identifier }, { name: identifier }] };
}

export function endpointListWhere(
  projectId: string,
  filters: {
    environmentId?: string;
    status?: "draft" | "deployed" | "disabled" | "failed";
    kind?: "mcp" | "http";
    q?: string;
  },
): Prisma.RuntimeEndpointWhereInput {
  return {
    projectId,
    ...(filters.environmentId ? { environmentId: filters.environmentId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: "insensitive" } },
            { slug: { contains: filters.q, mode: "insensitive" } },
            { description: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

// Every repository entry point requires the authenticated project id. Keeping
// tenant predicates here makes accidental cross-project reads difficult.
export const projectRepository = (projectId: string) => ({
  environments: () =>
    prisma.environment.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
    }),
  endpoints: (
    filters: {
      environmentId?: string;
      status?: "draft" | "deployed" | "disabled" | "failed";
      kind?: "mcp" | "http";
      q?: string;
    } = {},
  ) =>
    prisma.runtimeEndpoint.findMany({
      where: endpointListWhere(projectId, filters),
      include: {
        project: { include: { environments: true } },
        environment: true,
        defaultAuthPolicy: true,
        authPolicyAssignments: {
          include: { authPolicy: true },
          orderBy: { position: "asc" },
        },
        mcpToolBindings: { select: { functionId: true } },
        httpRouteBindings: { select: { functionId: true } },
        _count: { select: { mcpToolBindings: true, httpRouteBindings: true } },
        activeDeployment: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
  endpoint: async (identifier: string) => {
    const endpoint = await prisma.runtimeEndpoint.findFirst({
      where: { projectId, ...endpointIdentifierWhere(identifier) },
      include: {
        project: { include: { environments: true } },
        environment: true,
        activeDeployment: true,
        defaultAuthPolicy: true,
        authPolicyAssignments: {
          include: { authPolicy: true },
          orderBy: { position: "asc" },
        },
        mcpToolBindings: true,
        httpRouteBindings: true,
        networkPolicy: true,
        deployments: {
          orderBy: { version: "desc" },
          include: { logs: { orderBy: { createdAt: "asc" } } },
          take: 20,
        },
      },
    });
    if (!endpoint) return null;
    const functions = await prisma.function.findMany({
      where: { projectId },
      include: {
        versions: { orderBy: { version: "desc" }, take: 1 },
        grants: {
          include: {
            secret: { select: { id: true, name: true, environmentId: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    });
    return { ...endpoint, functions };
  },
  functions: () =>
    prisma.function.findMany({
      where: { projectId },
      include: {
        versions: { orderBy: { version: "desc" }, take: 1 },
        grants: {
          include: {
            secret: { select: { id: true, name: true, environmentId: true } },
          },
        },
        mcpToolBindings: {
          include: {
            endpoint: {
              select: {
                id: true,
                name: true,
                slug: true,
                kind: true,
                activeDeployment: { select: { snapshot: true } },
              },
            },
          },
        },
        httpRouteBindings: {
          include: {
            endpoint: {
              select: {
                id: true,
                name: true,
                slug: true,
                kind: true,
                activeDeployment: { select: { snapshot: true } },
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
  function: (_endpointIdentifier: string, functionIdentifier: string) =>
    prisma.function.findFirst({
      where: { projectId, ...functionIdentifierWhere(functionIdentifier) },
      include: {
        versions: { orderBy: { version: "desc" }, take: 1 },
        grants: {
          include: {
            secret: { select: { id: true, name: true, environmentId: true } },
          },
        },
      },
    }),
  projectFunction: (functionIdentifier: string) =>
    prisma.function.findFirst({
      where: { projectId, ...functionIdentifierWhere(functionIdentifier) },
      include: {
        versions: { orderBy: { version: "desc" }, take: 1 },
        grants: {
          include: {
            secret: { select: { id: true, name: true, environmentId: true } },
          },
        },
        mcpToolBindings: {
          include: {
            endpoint: { select: { id: true, name: true, slug: true, kind: true } },
          },
        },
        httpRouteBindings: {
          include: {
            endpoint: { select: { id: true, name: true, slug: true, kind: true } },
          },
        },
      },
    }),
  deployment: (endpointIdentifier: string, id: string) =>
    prisma.deployment.findFirst({
      where: {
        id,
        endpoint: { projectId, ...endpointIdentifierWhere(endpointIdentifier) },
      },
      include: { logs: true },
    }),
});
