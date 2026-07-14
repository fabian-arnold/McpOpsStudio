import { type FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import { globalSearchQuerySchema } from "@mcpops/shared";
import { sessionContext, parse } from "./helpers.js";
import { projectRepository } from "./repository.js";
import { deploymentFailureFunctions, record } from "./api-value-helpers.js";
import { inferFailedFunction, type FunctionSource } from "./deployment-failure.js";
import { platformCapabilities } from "./capabilities.js";
import { registerReviewedDatabaseRoutes } from "./reviewed-database-routes.js";

export async function registerDiscoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/environments", async (request) =>
    projectRepository(sessionContext(request).projectId).environments(),
  );
  app.get("/api/search", async (request) => {
    const session = sessionContext(request);
    const { q, limit } = parse(globalSearchQuerySchema, request.query);
    const [endpoints, functions, libraries] = await Promise.all([
      prisma.runtimeEndpoint.findMany({
        where: {
          projectId: session.projectId,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          name: true,
          slug: true,
          kind: true,
          environment: { select: { id: true, name: true } },
        },
        take: limit,
      }),
      prisma.function.findMany({
        where: {
          projectId: session.projectId,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          name: true,
        },
        take: limit,
      }),
      prisma.projectLibrary.findMany({
        where: {
          projectId: session.projectId,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { importPath: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, importPath: true, version: true },
        distinct: ["importPath"],
        orderBy: { version: "desc" },
        take: limit,
      }),
    ]);
    return {
      query: q,
      results: [
        ...endpoints.map((endpoint) => ({
          type: "endpoint",
          id: endpoint.id,
          title: endpoint.name,
          subtitle: endpoint.environment.name,
          href:
            endpoint.kind === "mcp"
              ? `/mcp-endpoints/${endpoint.id}`
              : `/http-apis/${endpoint.id}`,
        })),
        ...functions.map((fn) => ({
          type: "function",
          id: fn.id,
          title: fn.name,
          subtitle: "Project Function",
          href: `/functions/${fn.id}`,
        })),
        ...libraries.map((library) => ({
          type: "library",
          id: library.id,
          title: library.name,
          subtitle: `${library.importPath} Â· v${library.version}`,
          href: "/libraries",
        })),
      ].slice(0, limit),
    };
  });
  app.get("/api/notifications", async (request) => {
    const session = sessionContext(request);
    const [audits, failedDeployments, projectFunctions] = await Promise.all([
      prisma.auditEvent.findMany({
        where: {
          projectId: session.projectId,
          action: {
            in: [
              "function.invoke.denied",
              "deployment.rolled_back",
              "secret.rotated",
              "endpoint.disabled",
            ],
          },
        },
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          metadata: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.deployment.findMany({
        where: { endpoint: { projectId: session.projectId }, status: "failed" },
        select: {
          id: true,
          version: true,
          completedAt: true,
          projectDeployment: {
            select: {
              id: true,
              version: true,
              environment: { select: { name: true } },
            },
          },
          endpoint: { select: { id: true, name: true, kind: true } },
          logs: {
            where: { level: "error" },
            select: { message: true, metadata: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { completedAt: "desc" },
        take: 10,
      }),
      prisma.function.findMany({
        where: { projectId: session.projectId },
        select: {
          id: true,
          name: true,
          slug: true,
          versions: {
            select: { version: true, code: true },
            orderBy: { version: "desc" },
            take: 1,
          },
        },
      }),
    ]);
    const functionSources: FunctionSource[] = projectFunctions.flatMap((fn) =>
      fn.versions[0]
        ? [
            {
              id: fn.id,
              name: fn.name,
              slug: fn.slug,
              version: fn.versions[0].version,
              code: fn.versions[0].code,
            },
          ]
        : [],
    );
    const items = [
      ...audits.map((event) => ({
        id: `audit:${event.id}`,
        kind: "audit",
        severity: event.action.includes("denied") ? "warning" : "info",
        title: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        createdAt: event.createdAt,
      })),
      ...failedDeployments.map((deployment) => {
        const metadata = record(deployment.logs[0]?.metadata);
        const loggedFunctions = deploymentFailureFunctions(metadata);
        const inferredFunction = inferFailedFunction(
          deployment.logs[0]?.message,
          functionSources,
        );
        const functions = loggedFunctions.length
          ? loggedFunctions
          : inferredFunction
            ? [{ ...inferredFunction, inferred: true }]
            : [];
        return {
          id: `deployment:${deployment.id}`,
          kind: "deployment",
          severity: "error",
          title: deployment.projectDeployment
            ? `${deployment.projectDeployment.environment.name} deployment v${deployment.projectDeployment.version} failed`
            : `Deployment v${deployment.version} failed`,
          message:
            deployment.logs[0]?.message.slice(0, 8_000) ??
            "The deployment worker did not report a failure cause.",
          projectDeploymentId: deployment.projectDeployment?.id,
          endpointId: deployment.endpoint.id,
          endpointName: deployment.endpoint.name,
          functions,
          href: functions[0]
            ? `/functions/${functions[0].id}`
            : deployment.projectDeployment
              ? `/deployments?deployment=${deployment.projectDeployment.id}`
              : `${deployment.endpoint.kind === "mcp" ? "/mcp-endpoints" : "/http-apis"}/${deployment.endpoint.id}`,
          createdAt: deployment.completedAt,
        };
      }),
    ]
      .sort(
        (left, right) =>
          (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0),
      )
      .slice(0, 20);
    return { items, readStateSupported: false };
  });
  app.get("/api/account/security", async (request) => {
    const session = sessionContext(request);
    return {
      authentication: {
        provider: "local_password",
        mfaSupported: false,
        oidcStatus: "deferred",
        entraIdStatus: "deferred",
      },
      session: {
        email: session.email,
        role: session.role,
        expiresAt: new Date(session.expiresAt),
      },
    };
  });
  app.get("/api/capabilities", async () => platformCapabilities());
  await registerReviewedDatabaseRoutes(app);
}
