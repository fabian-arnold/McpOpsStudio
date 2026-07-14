import { type FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import { requireRole } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";
import { deploymentFailureFunctions, record } from "./api-value-helpers.js";
import { assertScopedCursor, replyCsv } from "./api-operation-helpers.js";
import {
  exposedProjectDeploymentVersion,
  summarizeDeployments,
  DAY_MS,
} from "./analytics.js";
import { csv, deploymentListQuerySchema } from "./listing.js";
import { inferFailedFunction, type FunctionSource } from "./deployment-failure.js";
import { dateWhere, registerObservabilityRoutes } from "./observability-routes.js";

export async function registerDeploymentHistoryRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/deployments/:projectDeploymentId/rollback", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "operator"]);
    const { projectDeploymentId } = request.params as {
      projectDeploymentId: string;
    };
    const target = await prisma.projectDeployment.findFirst({
      where: {
        id: projectDeploymentId,
        projectId: session.projectId,
        status: "rolled_back",
      },
      include: {
        environment: true,
        endpointDeployments: true,
        sourceProjectDeployment: { select: { version: true } },
      },
    });
    if (!target)
      return reply.status(409).send({
        error: {
          code: "INVALID_ROLLBACK_TARGET",
          message: "Select a completed previous project deployment.",
          requestId: requestId(request),
        },
      });
    const targetVersion = target.sourceProjectDeployment?.version ?? target.version;
    await prisma.$transaction(async (tx) => {
      if (target.environment.activeProjectDeploymentId) {
        await tx.projectDeployment.update({
          where: { id: target.environment.activeProjectDeploymentId },
          data: { status: "rolled_back" },
        });
        await tx.deployment.updateMany({
          where: {
            projectDeploymentId: target.environment.activeProjectDeploymentId,
          },
          data: { status: "rolled_back" },
        });
      }
      await tx.projectDeployment.update({
        where: { id: target.id },
        data: { status: "active" },
      });
      await tx.deployment.updateMany({
        where: { projectDeploymentId: target.id },
        data: { status: "active" },
      });
      await tx.environment.update({
        where: { id: target.environmentId },
        data: { activeProjectDeploymentId: target.id },
      });
      if (target.environment.slug === "development")
        for (const deployment of target.endpointDeployments)
          await tx.runtimeEndpoint.update({
            where: { id: deployment.endpointId },
            data: { activeDeploymentId: deployment.id, status: "deployed" },
          });
      await tx.auditEvent.create({
        data: {
          projectId: session.projectId,
          environmentId: target.environmentId,
          actorType: "user",
          actorId: session.userId,
          action: "project_deployment.rolled_back",
          targetType: "project_deployment",
          targetId: target.id,
          metadata: { version: targetVersion },
        },
      });
    });
    return {
      ok: true,
      activeProjectDeploymentId: target.id,
      version: targetVersion,
    };
  });

  app.get("/api/deployments", async (request, reply) => {
    const session = sessionContext(request);
    const query = parse(deploymentListQuerySchema, request.query);
    if (query.cursor)
      await assertScopedCursor("deployment", session.projectId, query.cursor);
    const summarySince = new Date(Date.now() - 7 * DAY_MS);
    const [rows, summaryRows, activeSnapshots, projectFunctions] = await Promise.all([
      prisma.projectDeployment.findMany({
        where: {
          projectId: session.projectId,
          ...(query.environmentId ? { environmentId: query.environmentId } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...dateWhere(query.from, query.to),
        },
        include: {
          environment: true,
          sourceProjectDeployment: { select: { id: true, version: true } },
          endpointDeployments: {
            where: { status: "failed" },
            select: {
              endpoint: { select: { name: true } },
              logs: {
                where: { level: "error" },
                select: { message: true, metadata: true },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
          _count: { select: { endpointDeployments: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      prisma.projectDeployment.findMany({
        where: {
          projectId: session.projectId,
          OR: [
            { createdAt: { gte: summarySince } },
            { status: { in: ["queued", "building", "deploying"] } },
          ],
        },
        select: { status: true, createdAt: true, completedAt: true },
      }),
      prisma.environment.count({
        where: {
          projectId: session.projectId,
          activeProjectDeploymentId: { not: null },
        },
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
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const items = page.map((deployment) => {
      const failedLog = deployment.endpointDeployments[0]?.logs[0];
      const failureMetadata = record(failedLog?.metadata);
      const loggedFunctions = deploymentFailureFunctions(failureMetadata);
      const inferredFunction = inferFailedFunction(failedLog?.message, functionSources);
      const failedFunctions = loggedFunctions.length
        ? loggedFunctions
        : inferredFunction
          ? [{ ...inferredFunction, inferred: true }]
          : [];
      return {
        id: deployment.id,
        version: exposedProjectDeploymentVersion(deployment),
        status: deployment.status,
        checksum: deployment.checksum,
        environment: {
          id: deployment.environment.id,
          name: deployment.environment.name,
          slug: deployment.environment.slug,
          baseUrl: deployment.environment.baseUrl,
        },
        endpointCount: deployment._count.endpointDeployments,
        sourceProjectDeployment: deployment.sourceProjectDeployment ?? undefined,
        createdAt: deployment.createdAt,
        completedAt: deployment.completedAt ?? undefined,
        failureCause: failedLog?.message.slice(0, 8_000) ?? undefined,
        failedEndpointName:
          deployment.endpointDeployments[0]?.endpoint.name ?? undefined,
        failedFunctions,
      };
    });
    if (query.format === "csv")
      return replyCsv(
        reply,
        csv(items, [
          "id",
          "environment",
          "version",
          "status",
          "checksum",
          "endpointCount",
          "createdAt",
          "completedAt",
        ]),
        `deployments-${new Date().toISOString().slice(0, 10)}.csv`,
      );
    return {
      items,
      nextCursor: hasMore ? page.at(-1)?.id : undefined,
      summary: summarizeDeployments(summaryRows, activeSnapshots),
    };
  });
  registerObservabilityRoutes(app);
}
