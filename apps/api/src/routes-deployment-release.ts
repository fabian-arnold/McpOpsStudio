import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@mcpops/db";
import { canonicalJson } from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { checksum, sessionContext, parse, requestId } from "./helpers.js";
import {
  arrayRecords,
  promoteEndpointSnapshot,
  record,
  stringList,
} from "./api-value-helpers.js";

export async function registerDeploymentReleaseRoutes(
  app: FastifyInstance,
): Promise<void> {
  const projectReleaseSchema = z.object({
    sourceProjectDeploymentId: z.string().uuid(),
  });

  app.post("/api/deployments/release", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "operator"]);
    const { sourceProjectDeploymentId } = parse(projectReleaseSchema, request.body);
    const source = await prisma.projectDeployment.findFirst({
      where: {
        id: sourceProjectDeploymentId,
        projectId: session.projectId,
        status: "active",
        environment: { slug: "development" },
      },
      include: {
        endpointDeployments: { include: { endpoint: true } },
      },
    });
    if (!source)
      return reply.status(409).send({
        error: {
          code: "INVALID_RELEASE_SOURCE",
          message: "Select the active development deployment.",
          requestId: requestId(request),
        },
      });
    const production = await prisma.environment.findFirst({
      where: { projectId: session.projectId, slug: "production" },
      include: { activeProjectDeployment: true },
    });
    if (!production)
      return reply.status(409).send({
        error: {
          code: "PRODUCTION_ENVIRONMENT_REQUIRED",
          message: "Create the production environment before releasing.",
          requestId: requestId(request),
        },
      });
    const existingRelease = await prisma.projectDeployment.findFirst({
      where: {
        projectId: session.projectId,
        environmentId: production.id,
        sourceProjectDeploymentId: source.id,
      },
      select: { id: true },
    });
    if (existingRelease)
      return reply.status(409).send({
        error: {
          code: "RELEASE_ALREADY_EXISTS",
          message: `Development v${source.version} already has a production release. Restore that production deployment instead of releasing it again.`,
          requestId: requestId(request),
        },
      });
    const productionSecrets = await prisma.secret.findMany({
      where: { projectId: session.projectId, environmentId: production.id },
      select: { id: true, name: true },
    });
    const productionConnections = await prisma.databaseConnection.findMany({
      where: {
        projectId: session.projectId,
        environmentId: production.id,
        enabled: true,
      },
      select: { id: true, name: true, secretId: true },
    });
    const connectionByName = new Map(
      productionConnections.map((connection) => [connection.name, connection]),
    );
    const secretNames = new Set(productionSecrets.map((secret) => secret.name));
    const requiredSecrets = new Set<string>();
    for (const deployment of source.endpointDeployments) {
      const snapshot = record(deployment.snapshot);
      for (const fn of arrayRecords(snapshot.functions))
        for (const name of stringList(fn.secretGrants)) requiredSecrets.add(name);
      for (const policy of arrayRecords(snapshot.authPolicies)) {
        const secretRef = record(policy.config).secretRef;
        if (typeof secretRef === "string") requiredSecrets.add(secretRef);
      }
      for (const query of arrayRecords(snapshot.reviewedQueries)) {
        const connection = record(query.connection);
        const name = typeof connection.name === "string" ? connection.name : "";
        if (name && !connectionByName.has(name))
          return reply.status(409).send({
            error: {
              code: "PRODUCTION_CONFIGURATION_INCOMPLETE",
              message: `Production is missing reviewed database connection '${name}'.`,
              requestId: requestId(request),
            },
          });
      }
    }
    const missingSecrets = [...requiredSecrets].filter(
      (name) => !secretNames.has(name),
    );
    if (missingSecrets.length)
      return reply.status(409).send({
        error: {
          code: "PRODUCTION_CONFIGURATION_INCOMPLETE",
          message: `Production is missing required secrets: ${missingSecrets.join(", ")}`,
          requestId: requestId(request),
        },
      });
    const latest = await prisma.projectDeployment.aggregate({
      where: { projectId: session.projectId, environmentId: production.id },
      _max: { version: true },
    });
    const result = await prisma.$transaction(async (tx) => {
      if (production.activeProjectDeploymentId) {
        await tx.projectDeployment.update({
          where: { id: production.activeProjectDeploymentId },
          data: { status: "rolled_back" },
        });
        await tx.deployment.updateMany({
          where: { projectDeploymentId: production.activeProjectDeploymentId },
          data: { status: "rolled_back" },
        });
      }
      const projectDeployment = await tx.projectDeployment.create({
        data: {
          projectId: session.projectId,
          environmentId: production.id,
          sourceProjectDeploymentId: source.id,
          version: (latest._max.version ?? 0) + 1,
          status: "active",
          completedAt: new Date(),
        },
      });
      const artifacts = [];
      for (const sourceDeployment of source.endpointDeployments) {
        const latestEndpoint = await tx.deployment.aggregate({
          where: { endpointId: sourceDeployment.endpointId },
          _max: { version: true },
        });
        const promotedSnapshot = promoteEndpointSnapshot(
          sourceDeployment.snapshot,
          production,
          connectionByName,
        );
        const promotedChecksum = checksum(canonicalJson(promotedSnapshot));
        const deployment = await tx.deployment.create({
          data: {
            endpointId: sourceDeployment.endpointId,
            projectDeploymentId: projectDeployment.id,
            version: (latestEndpoint._max.version ?? 0) + 1,
            status: "active",
            snapshot: promotedSnapshot as never,
            runtimeConfig: {
              ...record(sourceDeployment.runtimeConfig),
              env: record(production.variables),
            } as never,
            checksum: promotedChecksum,
            completedAt: new Date(),
          },
        });
        artifacts.push({
          endpointId: sourceDeployment.endpointId,
          deploymentId: deployment.id,
          version: deployment.version,
          checksum: promotedChecksum,
          endpoint: {
            id: sourceDeployment.endpoint.id,
            name: sourceDeployment.endpoint.name,
            slug: sourceDeployment.endpoint.slug,
            kind: sourceDeployment.endpoint.kind,
          },
          snapshot: promotedSnapshot,
        });
      }
      const projectSnapshot = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        projectId: session.projectId,
        environmentId: production.id,
        sourceProjectDeploymentId: source.id,
        version: source.version,
        endpoints: artifacts,
      };
      const projectChecksum = checksum(canonicalJson(projectSnapshot));
      await tx.projectDeployment.update({
        where: { id: projectDeployment.id },
        data: { snapshot: projectSnapshot as never, checksum: projectChecksum },
      });
      await tx.environment.update({
        where: { id: production.id },
        data: { activeProjectDeploymentId: projectDeployment.id },
      });
      await tx.auditEvent.create({
        data: {
          projectId: session.projectId,
          environmentId: production.id,
          actorType: "user",
          actorId: session.userId,
          action: "project_release.activated",
          targetType: "project_deployment",
          targetId: projectDeployment.id,
          metadata: {
            version: source.version,
            sourceProjectDeploymentId: source.id,
            checksum: projectChecksum,
          },
        },
      });
      return {
        ...projectDeployment,
        // Production exposes the immutable development version it promotes. The
        // database sequence remains private so existing release history never
        // needs to be renumbered during upgrades.
        version: source.version,
        snapshot: projectSnapshot,
        checksum: projectChecksum,
      };
    });
    return reply.status(201).send(result);
  });
}
