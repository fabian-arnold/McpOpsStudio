import { type FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import { endpointCreateSchema, endpointListQuerySchema } from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";
import { projectRepository } from "./repository.js";
import { endpointView } from "./api-view-helpers.js";
import {
  functionView,
  inspectCacheMetadata,
  inspectStorageMetadata,
  networkPolicyView,
  policyView,
  probeRuntimeEndpoint,
} from "./api-operation-helpers.js";
import { policySummary, summarizeExecutions, DAY_MS } from "./analytics.js";
import { bindingMapLayoutSchema, bindingMapNodeIds } from "./binding-map-layout.js";
import { executionView } from "./observability-routes.js";

export async function registerEndpointsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/runtime-endpoints", async (request) => {
    const session = sessionContext(request);
    const query = parse(endpointListQuerySchema, request.query);
    return (await projectRepository(session.projectId).endpoints(query)).map(
      endpointView,
    );
  });
  app.get("/api/binding-map", async (request) => {
    const session = sessionContext(request);
    const [project, endpoints] = await Promise.all([
      prisma.project.findUniqueOrThrow({
        where: { id: session.projectId },
        select: { bindingMapLayout: true },
      }),
      prisma.runtimeEndpoint.findMany({
        where: { projectId: session.projectId },
        select: {
          id: true,
          name: true,
          slug: true,
          kind: true,
          status: true,
          mcpToolBindings: {
            select: {
              id: true,
              functionId: true,
              toolName: true,
              title: true,
              enabled: true,
            },
            orderBy: { toolName: "asc" },
          },
          httpRouteBindings: {
            select: {
              id: true,
              functionId: true,
              method: true,
              path: true,
              enabled: true,
            },
            orderBy: [{ path: "asc" }, { method: "asc" }],
          },
        },
        orderBy: [{ kind: "asc" }, { name: "asc" }],
      }),
    ]);
    return { endpoints, layout: project.bindingMapLayout };
  });
  app.patch("/api/binding-map/layout", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const input = parse(bindingMapLayoutSchema, request.body);
    const [endpoints, functions] = await Promise.all([
      prisma.runtimeEndpoint.findMany({
        where: { projectId: session.projectId },
        select: {
          id: true,
          mcpToolBindings: { select: { id: true } },
          httpRouteBindings: { select: { id: true } },
        },
      }),
      prisma.function.findMany({
        where: { projectId: session.projectId },
        select: { id: true },
      }),
    ]);
    const validNodeIds = bindingMapNodeIds(endpoints, functions);
    const unknownNode = input.nodes.find((node) => !validNodeIds.has(node.id));
    if (unknownNode) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "The binding map contains a node outside the selected Project",
          requestId: requestId(request),
        },
      });
    }
    const layout = Object.fromEntries(
      input.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
    );
    await prisma.project.update({
      where: { id: session.projectId },
      data: { bindingMapLayout: layout },
    });
    return { layout };
  });
  app.post("/api/runtime-endpoints", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const input = parse(endpointCreateSchema, request.body);
    const environment = await prisma.environment.findFirst({
      where: { projectId: session.projectId, slug: "development" },
    });
    if (!environment)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Development environment not found",
          requestId: requestId(request),
        },
      });
    const collision = await prisma.runtimeEndpoint.findFirst({
      where: { projectId: session.projectId, kind: input.kind, slug: input.slug },
      select: { id: true },
    });
    if (collision)
      return reply.status(409).send({
        error: {
          code: "ENDPOINT_SLUG_CONFLICT",
          message: `A ${input.kind.toUpperCase()} endpoint with this slug already exists in the project`,
          requestId: requestId(request),
        },
      });
    const defaultAuthPolicy = await prisma.authPolicy.findFirst({
      where: { projectId: session.projectId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const endpoint = await prisma.$transaction(async (tx) => {
      const created = await tx.runtimeEndpoint.create({
        data: {
          projectId: session.projectId,
          ...input,
          environmentId: environment.id,
          defaultAuthPolicyId: defaultAuthPolicy?.id,
          status: "draft",
          runtimeVersion: "1.0.0",
        },
        include: {
          project: { include: { environments: true } },
          environment: true,
          defaultAuthPolicy: true,
          authPolicyAssignments: {
            include: { authPolicy: true },
            orderBy: { position: "asc" },
          },
          activeDeployment: true,
          _count: {
            select: {
              mcpToolBindings: true,
              httpRouteBindings: true,
            },
          },
        },
      });
      await tx.auditEvent.create({
        data: {
          projectId: session.projectId,
          environmentId: environment.id,
          endpointId: created.id,
          actorType: "user",
          actorId: session.userId,
          action: "endpoint.created",
          targetType: "runtime_endpoint",
          targetId: created.id,
          metadata: { name: created.name, slug: created.slug },
        },
      });
      if (defaultAuthPolicy)
        await tx.endpointAuthPolicy.create({
          data: {
            endpointId: created.id,
            authPolicyId: defaultAuthPolicy.id,
            position: 0,
          },
        });
      return created;
    });
    return reply.status(201).send(endpointView(endpoint));
  });
  app.get("/api/runtime-endpoints/:endpointId", async (request, reply) => {
    const session = sessionContext(request);
    const { endpointId } = request.params as { endpointId: string };
    const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
    if (!endpoint)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Runtime endpoint not found",
          requestId: requestId(request),
        },
      });
    const telemetrySince = new Date(Date.now() - 2 * DAY_MS);
    const [
      authPolicies,
      secrets,
      libraries,
      executions,
      telemetrySamples,
      storageMetrics,
      cacheMetrics,
      runtimeHealth,
    ] = await Promise.all([
      prisma.authPolicy.findMany({
        where: { projectId: session.projectId },
        orderBy: { name: "asc" },
      }),
      prisma.secret.findMany({
        where: {
          projectId: session.projectId,
          environmentId: endpoint.environmentId,
        },
        select: {
          id: true,
          name: true,
          environment: { select: { name: true } },
          updatedAt: true,
          _count: { select: { grants: true } },
        },
      }),
      prisma.projectLibrary.findMany({
        where: { projectId: session.projectId },
        orderBy: [{ name: "asc" }, { version: "desc" }],
      }),
      prisma.functionExecution.findMany({
        where: { projectId: session.projectId, endpointId },
        include: {
          function: true,
          functionVersion: true,
          deployment: true,
          mcpToolBinding: true,
          httpRouteBinding: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.functionExecution.findMany({
        where: {
          projectId: session.projectId,
          endpointId,
          createdAt: { gte: telemetrySince },
        },
        select: { createdAt: true, durationMs: true, status: true },
      }),
      inspectStorageMetadata(session.projectId, endpoint.environmentId),
      inspectCacheMetadata(session.projectId, endpoint.environmentId),
      probeRuntimeEndpoint(endpointId),
    ]);
    const telemetry = summarizeExecutions(telemetrySamples);
    const securityPosture = {
      ...policySummary(endpoint.activeDeployment?.snapshot, endpoint.defaultAuthPolicy),
      network: endpoint.networkPolicy
        ? {
            configured: true,
            allowedHostCount: Array.isArray(endpoint.networkPolicy.allowedHosts)
              ? endpoint.networkPolicy.allowedHosts.length
              : 0,
            allowedMethods: Array.isArray(endpoint.networkPolicy.allowedMethods)
              ? endpoint.networkPolicy.allowedMethods
              : [],
            maxResponseBytes: endpoint.networkPolicy.maxResponseBytes,
          }
        : {
            configured: false,
            allowedHostCount: 0,
            allowedMethods: [],
            maxResponseBytes: null,
          },
      trustedDeveloperExecution: true,
    };
    return {
      ...endpointView({
        ...endpoint,
        _count: {
          mcpToolBindings: endpoint.mcpToolBindings.length,
          httpRouteBindings: endpoint.httpRouteBindings.length,
        },
        defaultAuthPolicy: endpoint.defaultAuthPolicy,
      }),
      telemetry: {
        ...telemetry.current,
        comparisons: telemetry.comparisons,
        window: "24h",
      },
      runtimeHealth: {
        ...runtimeHealth,
        status:
          runtimeHealth.status === "unavailable"
            ? "unavailable"
            : runtimeHealth.status === "healthy" && cacheMetrics.status === "available"
              ? "healthy"
              : "degraded",
        dependencies: {
          controlPlaneDatabase: "healthy",
          cache: cacheMetrics.status === "available" ? "healthy" : "unavailable",
          activeDeployment: runtimeHealth.activeDeploymentLoadable
            ? "healthy"
            : "unavailable",
        },
      },
      securityPosture,
      storageMetrics: { storage: storageMetrics, cache: cacheMetrics },
      functions: endpoint.functions.map((fn) => functionView(fn)),
      mcpBindings: endpoint.mcpToolBindings,
      httpBindings: endpoint.httpRouteBindings,
      deployments: endpoint.deployments.map((deployment) => ({
        ...deployment,
        functionVersions: Array.isArray(
          (deployment.snapshot as { functions?: unknown[] }).functions,
        )
          ? (deployment.snapshot as { functions: unknown[] }).functions.length
          : 0,
      })),
      executions: executions.map(executionView),
      authPolicies: authPolicies.map(policyView),
      assignedAuthPolicies: endpoint.authPolicyAssignments.map((assignment) => ({
        ...policyView(assignment.authPolicy),
        position: assignment.position,
      })),
      secrets: secrets.map((secret) => ({
        id: secret.id,
        name: secret.name,
        environment: secret.environment.name,
        grants: secret._count.grants,
        updatedAt: secret.updatedAt,
      })),
      libraries,
      networkPolicy: networkPolicyView(endpoint.networkPolicy),
    };
  });
}
