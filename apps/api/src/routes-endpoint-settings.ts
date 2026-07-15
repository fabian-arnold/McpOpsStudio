import { type FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import {
  endpointCreateSchema,
  networkPolicyUpdateSchema,
  cachePurgeSchema,
  endpointSettingsUpdateSchema,
} from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";
import { projectRepository } from "./repository.js";
import { endpointSettingsView } from "./api-view-helpers.js";
import {
  networkPolicyView,
  purgeFunctionCache,
  writeControlAudit,
} from "./api-operation-helpers.js";
import { networkPolicyWarnings } from "./control-plane-validation.js";

export async function registerEndpointSettingsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.patch("/api/runtime-endpoints/:endpointId", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const { endpointId } = request.params as { endpointId: string };
    const current = await projectRepository(session.projectId).endpoint(endpointId);
    if (!current)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Runtime endpoint not found",
          requestId: requestId(request),
        },
      });
    const input = parse(
      endpointCreateSchema.omit({ kind: true }).partial(),
      request.body,
    );
    if (input.slug && input.slug !== current.slug) {
      const collision = await prisma.runtimeEndpoint.findFirst({
        where: {
          projectId: session.projectId,
          kind: current.kind,
          slug: input.slug ?? current.slug,
          id: { not: endpointId },
        },
        select: { id: true },
      });
      if (collision)
        return reply.status(409).send({
          error: {
            code: "ENDPOINT_SLUG_CONFLICT",
            message: "An endpoint of this type already uses this slug in the project",
            requestId: requestId(request),
          },
        });
    }
    const updated = await prisma.runtimeEndpoint.update({
      where: { id: endpointId },
      data: input,
    });
    await writeControlAudit(
      session,
      endpointId,
      "endpoint.updated",
      "runtime_endpoint",
      endpointId,
      {
        fields: Object.keys(input),
      },
    );
    return updated;
  });

  app.get("/api/runtime-endpoints/:endpointId/test-targets", async (request) => {
    const session = sessionContext(request);
    const { endpointId } = request.params as { endpointId: string };
    const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
    if (!endpoint)
      throw Object.assign(new Error("Runtime endpoint not found"), {
        statusCode: 404,
      });
    return {
      activeDeploymentId: endpoint.activeDeploymentId,
      targets: endpoint.functions
        .filter((fn) => fn.enabled)
        .map((fn) => ({
          functionId: fn.id,
          name: fn.name,
          riskLevel: fn.riskLevel,
          mcpTools: endpoint.mcpToolBindings
            .filter((binding) => binding.enabled && binding.functionId === fn.id)
            .map((binding) => ({ id: binding.id, toolName: binding.toolName })),
          httpRoutes: endpoint.httpRouteBindings
            .filter((binding) => binding.enabled && binding.functionId === fn.id)
            .map((binding) => ({
              id: binding.id,
              method: binding.method,
              path: binding.path,
            })),
          testUrl: `/api/runtime-endpoints/${endpointId}/functions/${fn.id}/test`,
        })),
    };
  });
  app.get("/api/runtime-endpoints/:endpointId/settings", async (request) => {
    const session = sessionContext(request);
    const { endpointId } = request.params as { endpointId: string };
    const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
    if (!endpoint)
      throw Object.assign(new Error("Runtime endpoint not found"), {
        statusCode: 404,
      });
    return endpointSettingsView(endpoint);
  });
  app.patch("/api/runtime-endpoints/:endpointId/settings", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
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
    const input = parse(endpointSettingsUpdateSchema, request.body);
    if (
      await prisma.runtimeEndpoint.findFirst({
        where: {
          projectId: session.projectId,
          environmentId: endpoint.environmentId,
          slug: input.slug,
          id: { not: endpointId },
        },
        select: { id: true },
      })
    )
      return reply.status(409).send({
        error: {
          code: "SERVICE_SLUG_CONFLICT",
          message: "A endpoint with this slug already exists in the environment",
          requestId: requestId(request),
        },
      });
    const runtimeConfig = {
      timeoutMs: input.runtime.timeoutMs,
      maxConcurrentRequests: input.runtime.maxConcurrentRequests,
      env: input.env,
      endpointAccessPolicy: input.endpointAccessPolicy,
    };
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.runtimeEndpoint.update({
        where: { id: endpointId },
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description,
          runtimeVersion: input.runtimeVersion,
          runtimeConfig,
        },
      });
      await tx.auditEvent.create({
        data: {
          projectId: session.projectId,
          environmentId: endpoint.environmentId,
          endpointId,
          actorType: "user",
          actorId: session.userId,
          action: "endpoint.settings.updated",
          targetType: "runtime_endpoint",
          targetId: endpointId,
          metadata: {
            name: row.name,
            slug: row.slug,
            runtimeVersion: input.runtimeVersion,
            timeoutMs: input.runtime.timeoutMs,
            maxConcurrentRequests: input.runtime.maxConcurrentRequests,
            environmentVariableNames: Object.keys(input.env),
            endpointAccessMode: input.endpointAccessPolicy.mode,
          },
        },
      });
      return row;
    });
    return endpointSettingsView({ ...endpoint, ...updated });
  });
  app.get("/api/runtime-endpoints/:endpointId/network-policy", async (request) => {
    const session = sessionContext(request);
    const { endpointId } = request.params as { endpointId: string };
    const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
    if (!endpoint)
      throw Object.assign(new Error("Runtime endpoint not found"), {
        statusCode: 404,
      });
    return networkPolicyView(endpoint.networkPolicy);
  });
  app.put("/api/runtime-endpoints/:endpointId/network-policy", async (request) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { endpointId } = request.params as { endpointId: string };
    const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
    if (!endpoint)
      throw Object.assign(new Error("Runtime endpoint not found"), {
        statusCode: 404,
      });
    const parsed = parse(networkPolicyUpdateSchema, request.body);
    const input = {
      ...parsed,
      allowPrivateHosts: parsed.allowPrivateHosts ?? [],
      allowInsecureTlsHosts: parsed.allowInsecureTlsHosts ?? [],
    };
    const policy = await prisma.networkPolicy.upsert({
      where: { endpointId },
      create: { projectId: session.projectId, endpointId, ...input },
      update: input,
    });
    await writeControlAudit(
      session,
      endpointId,
      "network_policy.updated",
      "network_policy",
      policy.id,
      {
        allowedHosts: input.allowedHosts,
        allowedMethods: input.allowedMethods,
        allowedPorts: input.allowedPorts,
        allowPrivateHosts: input.allowPrivateHosts,
        allowInsecureTlsHosts: input.allowInsecureTlsHosts,
        maxResponseBytes: input.maxResponseBytes,
        warningCodes: networkPolicyWarnings(
          input.allowedHosts,
          input.allowPrivateHosts,
          input.allowInsecureTlsHosts,
        ).map((warning) => warning.code),
      },
    );
    return networkPolicyView(policy);
  });
  app.get("/api/runtime-endpoints/:endpointId/storage/namespaces", async (request) => {
    const session = sessionContext(request);
    const { endpointId } = request.params as { endpointId: string };
    const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
    if (!endpoint)
      throw Object.assign(new Error("Runtime endpoint not found"), {
        statusCode: 404,
      });
    const now = new Date();
    const namespaces = await prisma.storageNamespace.findMany({
      where: {
        projectId: session.projectId,
        environmentId: endpoint.environmentId,
      },
      select: {
        id: true,
        name: true,
        environmentId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { entries: true } },
      },
      orderBy: { name: "asc" },
    });
    return {
      valuesExposed: false,
      keyMaterialExposed: false,
      namespaces: await Promise.all(
        namespaces.map(async (namespace) => ({
          id: namespace.id,
          name: namespace.name,
          environmentId: namespace.environmentId,
          createdAt: namespace.createdAt,
          updatedAt: namespace.updatedAt,
          storedKeys: namespace._count.entries,
          activeKeys: await prisma.storageEntry.count({
            where: {
              namespaceId: namespace.id,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
          }),
          expiredKeys: await prisma.storageEntry.count({
            where: { namespaceId: namespace.id, expiresAt: { lte: now } },
          }),
        })),
      ),
    };
  });
  app.post("/api/runtime-endpoints/:endpointId/cache/purge", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
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
    const input = parse(cachePurgeSchema, request.body);
    if (input.confirmEndpointSlug !== endpoint.slug)
      return reply.status(400).send({
        error: {
          code: "CONFIRMATION_MISMATCH",
          message: "Type the exact endpoint slug to confirm cache purge",
          requestId: requestId(request),
        },
      });
    const purgedKeys = await purgeFunctionCache(
      session.projectId,
      endpoint.environmentId,
    );
    await writeControlAudit(
      session,
      endpointId,
      "function_cache.purged",
      "runtime_endpoint",
      endpointId,
      { purgedKeys },
    );
    return {
      ok: true,
      purgedKeys,
      valuesExposed: false,
      keyMaterialExposed: false,
      purgedAt: new Date(),
    };
  });
}
