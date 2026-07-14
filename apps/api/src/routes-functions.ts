import { type FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import { functionCreateSchema, functionUpdateSchema } from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { checksum, sessionContext, parse, requestId } from "./helpers.js";
import { projectRepository } from "./repository.js";
import { record } from "./api-value-helpers.js";
import { functionView } from "./api-operation-helpers.js";

export async function registerFunctionsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/functions", async (request) => {
    const session = sessionContext(request);
    const functions = await projectRepository(session.projectId).functions();
    return functions.map((fn) => {
      const endpoints = new Map<
        string,
        {
          endpointId: string;
          endpointName: string;
          endpointKind: "mcp" | "http";
          mcpTools: string[];
          httpRoutes: string[];
          deployedVersion?: number;
          stale: boolean;
        }
      >();
      const usageFor = (endpoint: {
        id: string;
        name: string;
        kind: "mcp" | "http";
        activeDeployment: { snapshot: unknown } | null;
      }) => {
        const existing = endpoints.get(endpoint.id);
        if (existing) return existing;
        const snapshot = record(endpoint.activeDeployment?.snapshot);
        const deployed = Array.isArray(snapshot.functions)
          ? snapshot.functions.map(record).find((item) => item.functionId === fn.id)
          : undefined;
        const deployedVersion =
          typeof deployed?.version === "number" ? deployed.version : undefined;
        const usage: {
          endpointId: string;
          endpointName: string;
          endpointKind: "mcp" | "http";
          mcpTools: string[];
          httpRoutes: string[];
          deployedVersion?: number;
          stale: boolean;
        } = {
          endpointId: endpoint.id,
          endpointName: endpoint.name,
          endpointKind: endpoint.kind,
          mcpTools: [],
          httpRoutes: [],
          ...(deployedVersion ? { deployedVersion } : {}),
          stale: deployedVersion !== fn.version,
        };
        endpoints.set(endpoint.id, usage);
        return usage;
      };
      for (const binding of fn.mcpToolBindings) {
        usageFor(binding.endpoint).mcpTools.push(binding.toolName);
      }
      for (const binding of fn.httpRouteBindings) {
        usageFor(binding.endpoint).httpRoutes.push(`${binding.method} ${binding.path}`);
      }
      return { ...functionView(fn), usages: [...endpoints.values()] };
    });
  });

  app.post("/api/functions", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const input = parse(functionCreateSchema, request.body);
    const sum = checksum(input.code);
    const secretGrantIds = input.secretGrantIds ?? [];
    const fn = await prisma.$transaction(async (tx) => {
      const created = await tx.function.create({
        data: {
          projectId: session.projectId,
          name: input.name,
          slug: input.slug,
          description: input.description,
          code: input.code,
          inputSchema: input.inputSchema,
          outputSchema: input.outputSchema,
          timeoutMs: input.timeoutMs,
          enabled: input.enabled,
          riskLevel: input.riskLevel,
          requiredPermissions: input.requiredPermissions ?? [],
          cachePolicy: input.cachePolicy ?? undefined,
          version: 1,
        } as never,
      });
      await tx.functionVersion.create({
        data: {
          functionId: created.id,
          version: 1,
          code: input.code,
          checksum: sum,
          validationResult: { valid: false, state: "draft" },
          createdByUserId: session.userId,
        },
      });
      if (secretGrantIds.length) {
        const owned = await tx.secret.findMany({
          where: {
            id: { in: secretGrantIds },
            projectId: session.projectId,
          },
          select: { id: true, name: true },
        });
        if (owned.length !== secretGrantIds.length)
          throw Object.assign(new Error("One or more secret grant IDs are invalid"), {
            statusCode: 400,
            code: "INVALID_SECRET_GRANT",
          });
        const uniqueSecrets = [
          ...new Map(owned.map((secret) => [secret.name, secret])).values(),
        ];
        await tx.secretGrant.createMany({
          data: uniqueSecrets.map((secret) => ({
            functionId: created.id,
            secretId: secret.id,
            secretName: secret.name,
            accessMode: "read",
          })),
        });
      }
      await tx.auditEvent.create({
        data: {
          projectId: session.projectId,
          functionId: created.id,
          actorType: "user",
          actorId: session.userId,
          action: "function.created",
          targetType: "function",
          targetId: created.id,
          metadata: {
            name: created.name,
            slug: created.slug,
            version: 1,
            checksum: sum,
          },
        },
      });
      return created;
    });
    const result = await projectRepository(session.projectId).projectFunction(fn.id);
    return reply.status(201).send(result ? functionView(result, true) : fn);
  });
  app.route({
    method: ["PATCH", "PUT"],
    url: "/api/functions/:functionId",
    handler: async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin", "developer"]);
      const { functionId } = request.params as { functionId: string };
      const current = await projectRepository(session.projectId).projectFunction(
        functionId,
      );
      if (!current)
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Function not found",
            requestId: requestId(request),
          },
        });
      const input = parse(functionUpdateSchema, request.body);
      const nextVersion = current.version + (input.code === undefined ? 0 : 1);
      await prisma.$transaction(async (tx) => {
        const updated = await tx.function.update({
          where: { id: functionId },
          data: {
            name: input.name,
            slug: input.slug,
            description: input.description,
            code: input.code,
            inputSchema: input.inputSchema,
            outputSchema: input.outputSchema,
            timeoutMs: input.timeoutMs,
            enabled: input.enabled,
            riskLevel: input.riskLevel,
            requiredPermissions: input.requiredPermissions,
            cachePolicy: input.cachePolicy,
            version: nextVersion,
          } as never,
        });
        if (input.code !== undefined)
          await tx.functionVersion.create({
            data: {
              functionId,
              version: nextVersion,
              code: input.code,
              checksum: checksum(input.code),
              validationResult: { valid: false, state: "draft" },
              createdByUserId: session.userId,
            },
          });
        if (input.secretGrantIds !== undefined) {
          const owned = await tx.secret.findMany({
            where: {
              id: { in: input.secretGrantIds },
              projectId: session.projectId,
            },
            select: { id: true, name: true },
          });
          if (owned.length !== input.secretGrantIds.length)
            throw Object.assign(new Error("One or more secret grant IDs are invalid"), {
              statusCode: 400,
              code: "INVALID_SECRET_GRANT",
            });
          await tx.secretGrant.deleteMany({ where: { functionId } });
          if (owned.length) {
            const uniqueSecrets = [
              ...new Map(owned.map((secret) => [secret.name, secret])).values(),
            ];
            await tx.secretGrant.createMany({
              data: uniqueSecrets.map((secret) => ({
                functionId,
                secretId: secret.id,
                secretName: secret.name,
                accessMode: "read",
              })),
            });
          }
        }
        await tx.auditEvent.create({
          data: {
            projectId: session.projectId,
            functionId,
            actorType: "user",
            actorId: session.userId,
            action: "function.updated",
            targetType: "function",
            targetId: functionId,
            metadata: {
              name: updated.name,
              slug: updated.slug,
              version: nextVersion,
              ...(input.secretGrantIds
                ? { secretGrantCount: input.secretGrantIds.length }
                : {}),
            },
          },
        });
        return updated;
      });
      const result = await projectRepository(session.projectId).projectFunction(
        functionId,
      );
      return result
        ? functionView(result, true)
        : reply.status(404).send({
            error: {
              code: "NOT_FOUND",
              message: "Function not found",
              requestId: requestId(request),
            },
          });
    },
  });
}
