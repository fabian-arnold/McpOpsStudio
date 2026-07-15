import { type FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import { deploymentRuntimeConfigSchema, endpointStatusSchema } from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";
import { record, stringList } from "./api-value-helpers.js";
import { numericSetting } from "./api-view-helpers.js";
import { setEndpointEnabled } from "./api-operation-helpers.js";
import { deploymentJobOptions } from "./deployment-queue.js";
import { deploymentQueue } from "./resources.js";
import { resolveDevelopmentRuntimeEnvironment } from "./deployment-runtime-config.js";

export async function registerDeploymentCreateRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/runtime-endpoints/:endpointId/disable", async (request) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "operator"]);
    const { endpointId } = request.params as { endpointId: string };
    return setEndpointEnabled(session, endpointId, false);
  });
  app.post("/api/runtime-endpoints/:endpointId/enable", async (request) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "operator"]);
    const { endpointId } = request.params as { endpointId: string };
    return setEndpointEnabled(session, endpointId, true);
  });
  app.post("/api/runtime-endpoints/:endpointId/status", async (request) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "operator"]);
    const { endpointId } = request.params as { endpointId: string };
    const { status } = parse(endpointStatusSchema, request.body);
    return setEndpointEnabled(session, endpointId, status === "enabled");
  });

  const developmentDraftActions = [
    "endpoint.created",
    "endpoint.updated",
    "endpoint.settings.updated",
    "endpoint.enabled",
    "endpoint.disabled",
    "function.created",
    "function.updated",
    "mcp_binding.created",
    "mcp_binding.updated",
    "mcp_binding.deleted",
    "http_binding.created",
    "http_binding.updated",
    "http_binding.deleted",
    "cron_binding.created",
    "cron_binding.updated",
    "cron_binding.deleted",
    "network_policy.updated",
    "auth_policy.created",
    "auth_policy.updated",
    "auth_policy.deleted",
    "auth_policy.assigned",
    "auth_policy.reordered",
    "auth_policy.removed",
    "project_library.version_created",
    "template.installed",
    "manifest.applied",
  ] as const;

  app.get("/api/deployments/status", async (request) => {
    const session = sessionContext(request);
    const development = await prisma.environment.findFirst({
      where: { projectId: session.projectId, slug: "development" },
      select: { id: true, activeProjectDeploymentId: true },
    });
    const production = await prisma.environment.findFirst({
      where: { projectId: session.projectId, slug: "production" },
      select: {
        activeProjectDeployment: {
          select: {
            id: true,
            completedAt: true,
            sourceProjectDeployment: { select: { id: true, version: true } },
          },
        },
      },
    });
    if (!development)
      return {
        hasPendingChanges: false,
        hasPendingRelease: false,
        hasDeployableEndpoints: false,
        activeDeployment: null,
        productionDeployment: null,
        inProgressDeployment: null,
        latestDraftChange: null,
      };
    const [activeDeployment, inProgressDeployment, endpointCount, cronBindingCount] =
      await Promise.all([
        development.activeProjectDeploymentId
          ? prisma.projectDeployment.findUnique({
              where: { id: development.activeProjectDeploymentId },
              select: { id: true, version: true, completedAt: true },
            })
          : null,
        prisma.projectDeployment.findFirst({
          where: {
            projectId: session.projectId,
            environmentId: development.id,
            status: { in: ["queued", "building", "deploying"] },
          },
          select: { id: true, version: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.runtimeEndpoint.count({
          where: {
            projectId: session.projectId,
            environmentId: development.id,
            status: { not: "disabled" },
          },
        }),
        prisma.cronBinding.count({
          where: { projectId: session.projectId, deletedAt: null },
        }),
      ]);
    const latestDraftChange = await prisma.auditEvent.findFirst({
      where: {
        projectId: session.projectId,
        action: { in: [...developmentDraftActions] },
        ...(activeDeployment?.completedAt
          ? { createdAt: { gt: activeDeployment.completedAt } }
          : {}),
      },
      select: { action: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return {
      hasPendingChanges:
        (endpointCount > 0 || cronBindingCount > 0) &&
        (!activeDeployment || Boolean(latestDraftChange)),
      hasPendingRelease:
        Boolean(activeDeployment) &&
        production?.activeProjectDeployment?.sourceProjectDeployment?.id !==
          activeDeployment?.id,
      hasDeployableEndpoints: endpointCount > 0 || cronBindingCount > 0,
      activeDeployment,
      productionDeployment: production?.activeProjectDeployment
        ? {
            id: production.activeProjectDeployment.id,
            version:
              production.activeProjectDeployment.sourceProjectDeployment?.version ??
              null,
            completedAt: production.activeProjectDeployment.completedAt,
          }
        : null,
      inProgressDeployment,
      latestDraftChange,
    };
  });

  app.post("/api/deployments", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer", "operator"]);
    const environment = await prisma.environment.findFirst({
      where: { projectId: session.projectId, slug: "development" },
    });
    if (!environment)
      return reply.status(409).send({
        error: {
          code: "DEVELOPMENT_ENVIRONMENT_REQUIRED",
          message: "Create the development environment before deploying.",
          requestId: requestId(request),
        },
      });
    const endpoints = await prisma.runtimeEndpoint.findMany({
      where: {
        projectId: session.projectId,
        environmentId: environment.id,
        status: { not: "disabled" },
      },
      include: { activeDeployment: true, networkPolicy: true },
      orderBy: [{ kind: "asc" }, { slug: "asc" }],
    });
    const cronBindingCount = await prisma.cronBinding.count({
      where: { projectId: session.projectId, deletedAt: null },
    });
    if (!endpoints.length && !cronBindingCount)
      return reply.status(409).send({
        error: {
          code: "NO_RUNTIME_ENDPOINTS",
          message: "Add an MCP Endpoint, HTTP API, or cron binding before deploying.",
          requestId: requestId(request),
        },
      });
    const latestProject = await prisma.projectDeployment.aggregate({
      where: { projectId: session.projectId, environmentId: environment.id },
      _max: { version: true },
    });
    const endpointVersions = new Map<string, number>();
    for (const endpoint of endpoints) {
      const latest = await prisma.deployment.aggregate({
        where: { endpointId: endpoint.id },
        _max: { version: true },
      });
      endpointVersions.set(endpoint.id, (latest._max.version ?? 0) + 1);
    }
    const created = await prisma.$transaction(async (tx) => {
      const projectDeployment = await tx.projectDeployment.create({
        data: {
          projectId: session.projectId,
          environmentId: environment.id,
          version: (latestProject._max.version ?? 0) + 1,
          status: "queued",
        },
      });
      const scheduleDeployment = await tx.scheduleDeployment.create({
        data: {
          projectDeploymentId: projectDeployment.id,
          projectId: session.projectId,
          environmentId: environment.id,
          status: "queued",
        },
      });
      const childDeployments = [];
      for (const endpoint of endpoints) {
        const endpointConfig = record(endpoint.runtimeConfig);
        const activeConfig = record(endpoint.activeDeployment?.runtimeConfig);
        const activeSnapshot = record(endpoint.activeDeployment?.snapshot);
        const runtimeConfig = deploymentRuntimeConfigSchema.parse({
          env: resolveDevelopmentRuntimeEnvironment(
            environment.variables,
            endpointConfig,
            activeConfig,
            activeSnapshot,
          ),
          endpointAccessPolicy: record(
            endpointConfig.endpointAccessPolicy ??
              activeConfig.endpointAccessPolicy ??
              activeSnapshot.endpointAccessPolicy,
          ),
          network: endpoint.networkPolicy
            ? {
                allowPrivateHosts: stringList(endpoint.networkPolicy.allowPrivateHosts),
                allowInsecureTlsHosts: stringList(
                  endpoint.networkPolicy.allowInsecureTlsHosts,
                ),
              }
            : {
                allowPrivateHosts: stringList(
                  record(activeConfig.network).allowPrivateHosts ??
                    record(activeSnapshot.networkPolicy).allowPrivateHosts,
                ),
                allowInsecureTlsHosts: stringList(
                  record(activeConfig.network).allowInsecureTlsHosts ??
                    record(activeSnapshot.networkPolicy).allowInsecureTlsHosts,
                ),
              },
        });
        const child = await tx.deployment.create({
          data: {
            endpointId: endpoint.id,
            projectDeploymentId: projectDeployment.id,
            version: endpointVersions.get(endpoint.id) as number,
            status: "queued",
            snapshot: {},
            runtimeConfig: {
              ...runtimeConfig,
              timeoutMs: numericSetting(endpointConfig.timeoutMs, 30_000),
              maxConcurrentRequests: numericSetting(
                endpointConfig.maxConcurrentRequests,
                20,
              ),
              requestedBy: session.userId,
            },
            checksum: "pending",
          },
        });
        await tx.deploymentLog.create({
          data: {
            deploymentId: child.id,
            level: "info",
            message: "Project development deployment queued",
            metadata: { projectDeploymentId: projectDeployment.id },
          },
        });
        childDeployments.push(child);
      }
      await tx.auditEvent.create({
        data: {
          projectId: session.projectId,
          environmentId: environment.id,
          actorType: "user",
          actorId: session.userId,
          action: "project_deployment.queued",
          targetType: "project_deployment",
          targetId: projectDeployment.id,
          metadata: { version: projectDeployment.version },
        },
      });
      return { projectDeployment, childDeployments, scheduleDeployment };
    });
    for (const deployment of created.childDeployments)
      await deploymentQueue.add(
        "build",
        {
          deploymentId: deployment.id,
          projectId: session.projectId,
          actorId: session.userId,
        },
        deploymentJobOptions(deployment.id),
      );
    await deploymentQueue.add(
      "schedule-build",
      { scheduleDeploymentId: created.scheduleDeployment.id, actorId: session.userId },
      deploymentJobOptions(created.scheduleDeployment.id),
    );
    return reply.status(202).send({
      ...created.projectDeployment,
      endpointCount: created.childDeployments.length,
    });
  });
}
