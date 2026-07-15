import { prisma } from "@mcpops/db";
import { deploymentRuntimeConfigSchema } from "@mcpops/shared";
import type { PlatformSession } from "./auth.js";
import { checksum } from "./helpers.js";
import { record, stringList } from "./api-value-helpers.js";
import { numericSetting } from "./api-view-helpers.js";
import { resolveDevelopmentRuntimeEnvironment } from "./deployment-runtime-config.js";
import { deploymentJobOptions } from "./deployment-queue.js";
import { deploymentQueue } from "./resources.js";

export async function developmentDeploymentPlan(projectId: string) {
  const [endpoints, functions, libraries] = await Promise.all([
    prisma.runtimeEndpoint.findMany({
      where: {
        projectId,
        environment: { slug: "development" },
        status: { not: "disabled" },
      },
      include: { mcpToolBindings: true, httpRouteBindings: true },
      orderBy: [{ kind: "asc" }, { slug: "asc" }],
    }),
    prisma.function.findMany({
      where: { projectId },
      select: { id: true, version: true, updatedAt: true },
      orderBy: { id: "asc" },
    }),
    prisma.projectLibrary.findMany({
      where: { projectId },
      select: { importPath: true, version: true, updatedAt: true },
      orderBy: [{ importPath: "asc" }, { version: "desc" }],
    }),
  ]);
  const cronBindings = await prisma.cronBinding.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true, updatedAt: true, environmentId: true, functionId: true },
    orderBy: { id: "asc" },
  });
  const cronBindingCount = cronBindings.length;
  if (!endpoints.length && !cronBindingCount)
    throw Object.assign(new Error("Add a development endpoint before deploying"), {
      code: "NO_RUNTIME_ENDPOINTS",
      statusCode: 409,
    });
  const state = {
    endpoints: endpoints.map((endpoint) => ({
      id: endpoint.id,
      updatedAt: endpoint.updatedAt.toISOString(),
      bindings:
        endpoint.kind === "mcp" ? endpoint.mcpToolBindings : endpoint.httpRouteBindings,
    })),
    functions: functions.map((fn) => ({
      ...fn,
      updatedAt: fn.updatedAt.toISOString(),
    })),
    libraries: libraries.map((library) => ({
      ...library,
      updatedAt: library.updatedAt.toISOString(),
    })),
    cronBindings: cronBindings.map((binding) => ({
      ...binding,
      updatedAt: binding.updatedAt.toISOString(),
    })),
  };
  return {
    ...state,
    endpointCount: endpoints.length,
    functionCount: functions.length,
    planChecksum: checksum(JSON.stringify(state)),
  };
}

// Project deployment queues endpoint and schedule artifacts as one atomic plan.
// eslint-disable-next-line max-lines-per-function
export async function queueDevelopmentDeployment(session: PlatformSession) {
  const environment = await prisma.environment.findFirst({
    where: { projectId: session.projectId, slug: "development" },
  });
  if (!environment)
    throw Object.assign(
      new Error("Create the development environment before deploying."),
      { code: "DEVELOPMENT_ENVIRONMENT_REQUIRED", statusCode: 409 },
    );
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
    throw Object.assign(
      new Error("Add an MCP Endpoint, HTTP API, or cron binding before deploying."),
      { code: "NO_RUNTIME_ENDPOINTS", statusCode: 409 },
    );
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
          version: endpointVersions.get(endpoint.id)!,
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
        metadata: { version: projectDeployment.version, source: "control_plane" },
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
  return {
    ...created.projectDeployment,
    endpointCount: created.childDeployments.length,
  };
}
