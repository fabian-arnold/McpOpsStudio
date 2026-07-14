import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@mcpops/db";
import { manifestImportSchema, parseManifest, serializeManifest } from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";
import { projectRepository } from "./repository.js";
import { createManifestPlan, currentEndpointManifest } from "./api-view-helpers.js";
import { canonicalEnvironmentEndpointUrls } from "./analytics.js";
import {
  availableEndpointDocumentFormats,
  endpointDocumentFormats,
  generateEndpointDocument,
} from "./endpoint-discovery.js";

export async function registerManifestsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/runtime-endpoints/:endpointId/manifest", async (request, reply) => {
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
    const manifest = currentEndpointManifest(endpoint);
    const format = (
      (request.query as { format?: string }).format === "json" ? "json" : "yaml"
    ) as "yaml" | "json";
    return {
      format,
      content: serializeManifest(manifest, format),
      manifest,
      containsSecretValues: false,
    };
  });
  app.get("/api/runtime-endpoints/:endpointId/discovery", async (request, reply) => {
    const session = sessionContext(request);
    const { endpointId } = request.params as { endpointId: string };
    const { format } = parse(
      z.object({ format: z.enum(endpointDocumentFormats) }).strict(),
      request.query,
    );
    const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
    if (!endpoint)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Runtime endpoint not found",
          requestId: requestId(request),
        },
      });
    const formats = availableEndpointDocumentFormats(endpoint.kind);
    if (!formats.includes(format))
      return reply.status(400).send({
        error: {
          code: "UNSUPPORTED_FORMAT",
          message: `${format} is not available for ${endpoint.kind.toUpperCase()} endpoints`,
          requestId: requestId(request),
        },
      });
    const environmentUrls = canonicalEnvironmentEndpointUrls(
      endpoint.project.environments,
      endpoint.project.slug,
      endpoint.slug,
    );
    const document = generateEndpointDocument(format, {
      manifest: currentEndpointManifest(endpoint),
      environments: endpoint.project.environments.flatMap((environment) => {
        const urls = environmentUrls[environment.slug];
        return urls
          ? [
              {
                name: environment.slug.replace(
                  /(^|-)([a-z])/g,
                  (_match, lead, letter) =>
                    `${lead ? " " : ""}${String(letter).toUpperCase()}`,
                ),
                slug: environment.slug,
                mcpUrl: urls.mcpUrl,
                httpBaseUrl: urls.httpBaseUrl,
              },
            ]
          : [];
      }),
      functions: endpoint.functions.map((fn) => ({
        name: fn.name,
        inputSchema: fn.inputSchema,
        outputSchema: fn.outputSchema ?? undefined,
      })),
      auth: endpoint.defaultAuthPolicy
        ? {
            type: endpoint.defaultAuthPolicy.type,
            config: endpoint.defaultAuthPolicy.config,
          }
        : null,
    });
    return {
      ...document,
      formats,
      containsSecretValues: false,
    };
  });
  app.post(
    "/api/runtime-endpoints/:endpointId/manifest/preview",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin", "developer"]);
      const { endpointId } = request.params as { endpointId: string };
      const body = parse(manifestImportSchema.omit({ apply: true }), request.body);
      const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
      if (!endpoint)
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Runtime endpoint not found",
            requestId: requestId(request),
          },
        });
      const manifest = parseManifest(body.content, body.format);
      const plan = await createManifestPlan(session.projectId, endpoint, manifest);
      return { ...plan, manifest, atomic: true, containsSecretValues: false };
    },
  );
  app.post("/api/runtime-endpoints/:endpointId/manifest", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const { endpointId } = request.params as { endpointId: string };
    const body = parse(manifestImportSchema, request.body);
    const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
    if (!endpoint)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Runtime endpoint not found",
          requestId: requestId(request),
        },
      });
    const manifest = parseManifest(body.content, body.format);
    const plan = await createManifestPlan(session.projectId, endpoint, manifest);
    if (!body.apply)
      return {
        ...plan,
        manifest,
        applied: false,
        atomic: true,
        containsSecretValues: false,
      };
    if (!plan.valid)
      return reply.status(422).send({
        error: {
          code: "MANIFEST_PLAN_INVALID",
          message: "Manifest cannot be applied until all plan errors are resolved",
          requestId: requestId(request),
          details: plan.errors,
        },
        plan,
        applied: false,
      });
    const functionsByName = new Map(endpoint.functions.map((fn) => [fn.name, fn]));
    const policies = await prisma.authPolicy.findMany({
      where: { projectId: session.projectId },
    });
    const policiesByName = new Map(policies.map((policy) => [policy.name, policy]));
    const defaultPolicyId = manifest.auth
      ? (policiesByName.get(manifest.auth.policy)?.id ?? null)
      : null;
    const endpointRuntimeConfig = {
      timeoutMs: manifest.endpoint.runtime.timeoutMs,
      maxConcurrentRequests: manifest.endpoint.runtime.maxConcurrentRequests,
      env: manifest.endpoint.runtime.env,
      endpointAccessPolicy: manifest.endpoint.runtime.endpointAccessPolicy,
    };
    await prisma.$transaction(async (tx) => {
      await tx.runtimeEndpoint.update({
        where: { id: endpointId },
        data: {
          name: manifest.endpoint.name,
          slug: manifest.endpoint.slug,
          description: manifest.endpoint.description,
          runtimeVersion: manifest.endpoint.runtimeVersion,
          runtimeConfig: endpointRuntimeConfig,
          defaultAuthPolicyId: defaultPolicyId,
        },
      });
      await tx.networkPolicy.upsert({
        where: { endpointId },
        create: {
          projectId: session.projectId,
          endpointId,
          ...manifest.endpoint.network,
        },
        update: manifest.endpoint.network,
      });
      for (const fn of manifest.functions)
        await tx.function.update({
          where: { id: functionsByName.get(fn.name)!.id },
          data: {
            enabled: fn.enabled,
            riskLevel: fn.riskLevel,
            requiredPermissions: fn.requiredPermissions,
          },
        });
      const desiredToolNames = (manifest.mcp?.tools ?? []).map((tool) => tool.toolName);
      if (desiredToolNames.length)
        await tx.mcpToolBinding.deleteMany({
          where: { endpointId, toolName: { notIn: desiredToolNames } },
        });
      else await tx.mcpToolBinding.deleteMany({ where: { endpointId } });
      for (const tool of manifest.mcp?.tools ?? []) {
        const fn = functionsByName.get(tool.function)!;
        await tx.mcpToolBinding.upsert({
          where: {
            endpointId_toolName: { endpointId, toolName: tool.toolName },
          },
          create: {
            endpointId,
            functionId: fn.id,
            toolName: tool.toolName,
            title: tool.title ?? tool.toolName,
            description: tool.description,
            enabled: tool.enabled,
          },
          update: {
            functionId: fn.id,
            title: tool.title ?? tool.toolName,
            description: tool.description,
            enabled: tool.enabled,
          },
        });
      }
      const desiredRouteKeys = new Set(
        (manifest.http?.routes ?? []).map((route) => `${route.method} ${route.path}`),
      );
      const deletedRouteIds = endpoint.httpRouteBindings
        .filter((binding) => !desiredRouteKeys.has(`${binding.method} ${binding.path}`))
        .map((binding) => binding.id);
      if (deletedRouteIds.length)
        await tx.httpRouteBinding.deleteMany({
          where: { id: { in: deletedRouteIds }, endpointId },
        });
      for (const route of manifest.http?.routes ?? []) {
        const fn = functionsByName.get(route.function)!;
        await tx.httpRouteBinding.upsert({
          where: {
            endpointId_method_path: {
              endpointId,
              method: route.method,
              path: route.path,
            },
          },
          create: {
            endpointId,
            functionId: fn.id,
            method: route.method,
            path: route.path,
            inputMapping: route.inputMapping,
            responseMapping: route.responseMapping,
            enabled: route.enabled,
          } as never,
          update: {
            functionId: fn.id,
            inputMapping: route.inputMapping,
            responseMapping: route.responseMapping,
            enabled: route.enabled,
          } as never,
        });
      }
      await tx.auditEvent.create({
        data: {
          projectId: session.projectId,
          environmentId: endpoint.environmentId,
          endpointId,
          actorType: "user",
          actorId: session.userId,
          action: "manifest.applied",
          targetType: "runtime_endpoint",
          targetId: endpointId,
          metadata: {
            summary: plan.summary,
            format: body.format,
            containsSecretValues: false,
          },
        },
      });
    });
    return {
      valid: true,
      applied: true,
      atomic: true,
      manifest,
      plan,
      containsSecretValues: false,
    };
  });
}
