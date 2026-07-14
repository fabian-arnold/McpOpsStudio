import { type FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import { requireRole } from "./auth.js";
import { sessionContext } from "./helpers.js";
import { probeRedisDependency } from "./api-operation-helpers.js";
import {
  canonicalEndpointUrls,
  canonicalEnvironmentEndpointUrls,
  exposedProjectDeploymentVersion,
  hourlyTraffic,
  summarizeExecutions,
  summarizeGlobalProjectExecutions,
  DAY_MS,
} from "./analytics.js";
import { auditView, executionView } from "./observability-routes.js";

export async function registerOverviewRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/global-overview", async (request) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const now = new Date();
    const since = new Date(now.getTime() - DAY_MS);
    const [projects, groupedExecutions] = await Promise.all([
      prisma.project.findMany({
        include: {
          _count: { select: { endpoints: true, functions: true } },
          environments: {
            select: {
              id: true,
              name: true,
              slug: true,
              activeProjectDeployment: {
                select: {
                  id: true,
                  version: true,
                  status: true,
                  completedAt: true,
                  sourceProjectDeployment: { select: { version: true } },
                },
              },
            },
            orderBy: { name: "asc" },
          },
          endpoints: {
            select: {
              kind: true,
              status: true,
              activeDeployment: { select: { version: true } },
            },
          },
          projectDeployments: {
            select: {
              id: true,
              version: true,
              status: true,
              createdAt: true,
              completedAt: true,
              environment: { select: { name: true, slug: true } },
              sourceProjectDeployment: { select: { version: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.functionExecution.groupBy({
        by: ["projectId", "status"],
        where: { createdAt: { gte: since, lte: now } },
        _count: { _all: true },
        _sum: { durationMs: true },
      }),
    ]);
    const executions = summarizeGlobalProjectExecutions(
      groupedExecutions.map((sample) => ({
        projectId: sample.projectId,
        status: sample.status,
        count: sample._count._all,
        totalDurationMs: sample._sum.durationMs ?? 0,
      })),
    );
    const emptyExecutionSummary = {
      calls24h: 0,
      failedCalls24h: 0,
      errorRate: 0,
      averageLatencyMs: 0,
    };
    const projectViews = projects.map((project) => {
      const deployedEndpoints = project.endpoints.filter(
        (endpoint) => endpoint.status === "deployed",
      ).length;
      const activeSnapshots = project.endpoints.filter(
        (endpoint) => endpoint.activeDeployment !== null,
      ).length;
      const failedEndpoints = project.endpoints.filter(
        (endpoint) => endpoint.status === "failed",
      ).length;
      const execution = executions.get(project.id) ?? emptyExecutionSummary;
      return {
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        status: project.status,
        updatedAt: project.updatedAt,
        health:
          project.status === "archived"
            ? "archived"
            : failedEndpoints > 0 || activeSnapshots < deployedEndpoints
              ? "degraded"
              : "healthy",
        endpoints: {
          total: project._count.endpoints,
          mcp: project.endpoints.filter((endpoint) => endpoint.kind === "mcp").length,
          http: project.endpoints.filter((endpoint) => endpoint.kind === "http").length,
          deployed: deployedEndpoints,
          failed: failedEndpoints,
          activeSnapshots,
        },
        functions: project._count.functions,
        execution,
        environments: project.environments.map((environment) => ({
          id: environment.id,
          name: environment.name,
          slug: environment.slug,
          activeDeployment: environment.activeProjectDeployment
            ? {
                ...environment.activeProjectDeployment,
                version: exposedProjectDeploymentVersion(
                  environment.activeProjectDeployment,
                ),
                sourceProjectDeployment: undefined,
              }
            : null,
        })),
        latestDeployment: project.projectDeployments[0]
          ? {
              ...project.projectDeployments[0],
              version: exposedProjectDeploymentVersion(project.projectDeployments[0]),
              sourceProjectDeployment: undefined,
            }
          : null,
      };
    });
    const totalCalls = projectViews.reduce(
      (sum, project) => sum + project.execution.calls24h,
      0,
    );
    const totalFailures = projectViews.reduce(
      (sum, project) => sum + project.execution.failedCalls24h,
      0,
    );
    return {
      generatedAt: now,
      window: "24h",
      stats: {
        projects: projectViews.length,
        activeProjects: projectViews.filter((project) => project.status === "active")
          .length,
        endpoints: projectViews.reduce(
          (sum, project) => sum + project.endpoints.total,
          0,
        ),
        functions: projectViews.reduce((sum, project) => sum + project.functions, 0),
        calls24h: totalCalls,
        failedCalls24h: totalFailures,
        errorRate: totalCalls
          ? Math.round((totalFailures / totalCalls) * 1_000) / 10
          : 0,
        degradedProjects: projectViews.filter(
          (project) => project.health === "degraded",
        ).length,
      },
      projects: projectViews,
    };
  });
  app.get("/api/dashboard", async (request) => {
    const { projectId } = sessionContext(request);
    const now = new Date();
    const since = new Date(now.getTime() - 2 * DAY_MS);
    const currentSince = new Date(now.getTime() - DAY_MS);
    const [
      endpointCount,
      activeEndpointCount,
      executionSamples,
      deployments,
      recentFailedDeployments,
      auditEvents,
      recentExecutions,
      recentFailures,
      redisHealth,
    ] = await Promise.all([
      prisma.runtimeEndpoint.count({ where: { projectId, status: "deployed" } }),
      prisma.runtimeEndpoint.count({
        where: {
          projectId,
          status: "deployed",
          activeDeploymentId: { not: null },
        },
      }),
      prisma.functionExecution.findMany({
        where: { projectId, createdAt: { gte: since, lte: now } },
        select: { createdAt: true, durationMs: true, status: true },
      }),
      prisma.deployment.findMany({
        where: { endpoint: { projectId }, status: "active" },
        include: {
          projectDeployment: {
            select: {
              version: true,
              sourceProjectDeployment: { select: { version: true } },
            },
          },
          endpoint: {
            include: {
              project: { include: { environments: true } },
              environment: true,
            },
          },
        },
        take: 10,
        orderBy: { completedAt: "desc" },
      }),
      prisma.deployment.findMany({
        where: {
          endpoint: { projectId },
          status: "failed",
          createdAt: { gte: currentSince },
        },
        select: {
          id: true,
          version: true,
          createdAt: true,
          completedAt: true,
          endpoint: { select: { id: true, name: true } },
        },
        take: 5,
        orderBy: { createdAt: "desc" },
      }),
      prisma.auditEvent.findMany({
        where: { projectId },
        take: 10,
        orderBy: { createdAt: "desc" },
      }),
      prisma.functionExecution.findMany({
        where: { projectId },
        include: { function: true, deployment: true, functionVersion: true },
        take: 8,
        orderBy: { createdAt: "desc" },
      }),
      prisma.functionExecution.findMany({
        where: {
          projectId,
          createdAt: { gte: currentSince },
          status: { in: ["error", "timeout", "validation_error", "denied"] },
        },
        include: { function: true, deployment: true, functionVersion: true },
        take: 8,
        orderBy: { createdAt: "desc" },
      }),
      probeRedisDependency(),
    ]);
    const executionSummary = summarizeExecutions(executionSamples, now);
    const trafficBuckets = hourlyTraffic(executionSamples, now);
    const activeDeployments = deployments.map((deployment) => ({
      id: deployment.id,
      version: deployment.projectDeployment
        ? exposedProjectDeploymentVersion(deployment.projectDeployment)
        : deployment.version,
      checksum: deployment.checksum,
      completedAt: deployment.completedAt,
      endpoint: {
        id: deployment.endpoint.id,
        name: deployment.endpoint.name,
        slug: deployment.endpoint.slug,
        kind: deployment.endpoint.kind,
      },
      endpoints: canonicalEndpointUrls(
        deployment.endpoint.environment.baseUrl,
        deployment.endpoint.project.slug,
        deployment.endpoint.slug,
        deployment.endpoint.environment.slug === "development" ? "-dev" : "",
      ),
      environmentEndpoints: canonicalEnvironmentEndpointUrls(
        deployment.endpoint.project.environments,
        deployment.endpoint.project.slug,
        deployment.endpoint.slug,
      ),
    }));
    return {
      context: {
        generatedAt: now,
        window: "24h",
        previousWindow: "preceding_24h",
        bucketMinutes: 60,
      },
      stats: {
        endpoints: endpointCount,
        calls24h: executionSummary.current.calls,
        failedCalls24h: executionSummary.current.failures,
        errorRate: executionSummary.current.errorRate,
        averageLatencyMs: executionSummary.current.averageLatencyMs,
        p95LatencyMs: executionSummary.current.p95LatencyMs,
        activeDeployments: activeEndpointCount,
      },
      comparisons: executionSummary.comparisons,
      trafficBuckets,
      sparkline: trafficBuckets.map((bucket) => bucket.calls),
      health: {
        status:
          recentFailedDeployments.length ||
          activeEndpointCount < endpointCount ||
          redisHealth !== "healthy"
            ? "degraded"
            : "healthy",
        database: "healthy",
        redis: redisHealth,
        deployedEndpoints: endpointCount,
        endpointsWithActiveSnapshot: activeEndpointCount,
        endpointsWithoutActiveSnapshot: Math.max(
          0,
          endpointCount - activeEndpointCount,
        ),
        failedDeployments24h: recentFailedDeployments.length,
      },
      activeDeployments,
      recentFailedDeployments,
      recentFailures: recentFailures.map(executionView),
      recentExecutions: recentExecutions.map(executionView),
      auditEvents: auditEvents.map(auditView),
    };
  });
}
