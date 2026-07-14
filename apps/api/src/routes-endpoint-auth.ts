import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@mcpops/db";
import { authPolicyMutationSchema } from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";
import { projectRepository } from "./repository.js";
import { record } from "./api-value-helpers.js";
import {
  policyView,
  validatePolicySecretIfRequired,
  writeControlAudit,
} from "./api-operation-helpers.js";

export async function registerEndpointAuthRoutes(app: FastifyInstance): Promise<void> {
  const authPolicyOrderSchema = z
    .object({ policyIds: z.array(z.string().uuid()).min(1) })
    .strict();

  app.post(
    "/api/runtime-endpoints/:endpointId/auth-policies",
    async (request, reply) => {
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
      const input = parse(authPolicyMutationSchema, request.body);
      await validatePolicySecretIfRequired(
        session.projectId,
        endpoint.environmentId,
        input.config,
      );
      if (
        await prisma.authPolicy.findFirst({
          where: { projectId: session.projectId, name: input.name },
          select: { id: true },
        })
      )
        return reply.status(409).send({
          error: {
            code: "AUTH_POLICY_NAME_CONFLICT",
            message: "An authentication policy with this name already exists",
            requestId: requestId(request),
          },
        });
      const result = await prisma.$transaction(async (tx) => {
        const created = await tx.authPolicy.create({
          data: { projectId: session.projectId, ...input } as never,
        });
        const latest = await tx.endpointAuthPolicy.aggregate({
          where: { endpointId },
          _max: { position: true },
        });
        await tx.endpointAuthPolicy.create({
          data: {
            endpointId,
            authPolicyId: created.id,
            position: (latest._max.position ?? -1) + 1,
          },
        });
        if (!endpoint.defaultAuthPolicyId)
          await tx.runtimeEndpoint.update({
            where: { id: endpointId },
            data: { defaultAuthPolicyId: created.id },
          });
        await tx.auditEvent.create({
          data: {
            projectId: session.projectId,
            endpointId,
            actorType: "user",
            actorId: session.userId,
            action: "auth_policy.created",
            targetType: "auth_policy",
            targetId: created.id,
            metadata: { name: created.name, type: created.type },
          },
        });
        return created;
      });
      return reply.status(201).send(policyView(result));
    },
  );
  app.patch(
    "/api/runtime-endpoints/:endpointId/auth-policies/:policyId",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin"]);
      const { endpointId, policyId } = request.params as {
        endpointId: string;
        policyId: string;
      };
      const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
      if (!endpoint)
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Runtime endpoint not found",
            requestId: requestId(request),
          },
        });
      const owned = await prisma.authPolicy.findFirst({
        where: {
          id: policyId,
          projectId: session.projectId,
          endpointAssignments: { some: { endpointId } },
        },
      });
      if (!owned)
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Authentication policy not found for this endpoint",
            requestId: requestId(request),
          },
        });
      const input = parse(authPolicyMutationSchema, request.body);
      await validatePolicySecretIfRequired(
        session.projectId,
        endpoint.environmentId,
        input.config,
      );
      if (
        await prisma.authPolicy.findFirst({
          where: {
            projectId: session.projectId,
            name: input.name,
            id: { not: policyId },
          },
          select: { id: true },
        })
      )
        return reply.status(409).send({
          error: {
            code: "AUTH_POLICY_NAME_CONFLICT",
            message: "An authentication policy with this name already exists",
            requestId: requestId(request),
          },
        });
      const updated = await prisma.authPolicy.update({
        where: { id: policyId },
        data: input as never,
      });
      await writeControlAudit(
        session,
        endpointId,
        "auth_policy.updated",
        "auth_policy",
        policyId,
        {
          name: updated.name,
          type: updated.type,
        },
      );
      return policyView(updated);
    },
  );
  app.post(
    "/api/runtime-endpoints/:endpointId/auth-policies/:policyId/default",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin"]);
      const { endpointId, policyId } = request.params as {
        endpointId: string;
        policyId: string;
      };
      const [endpoint, policy] = await Promise.all([
        prisma.runtimeEndpoint.findFirst({
          where: { id: endpointId, projectId: session.projectId },
        }),
        prisma.authPolicy.findFirst({
          where: { id: policyId, projectId: session.projectId },
        }),
      ]);
      if (!endpoint || !policy)
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Runtime endpoint or authentication policy not found",
            requestId: requestId(request),
          },
        });
      await validatePolicySecretIfRequired(
        session.projectId,
        endpoint.environmentId,
        record(policy.config),
      );
      const existing = await prisma.endpointAuthPolicy.findUnique({
        where: {
          endpointId_authPolicyId: { endpointId, authPolicyId: policyId },
        },
      });
      if (!existing) {
        const latest = await prisma.endpointAuthPolicy.aggregate({
          where: { endpointId },
          _max: { position: true },
        });
        await prisma.endpointAuthPolicy.create({
          data: {
            endpointId,
            authPolicyId: policyId,
            position: (latest._max.position ?? -1) + 1,
          },
        });
      }
      await writeControlAudit(
        session,
        endpointId,
        "auth_policy.assigned",
        "auth_policy",
        policyId,
        {
          name: policy.name,
          type: policy.type,
        },
      );
      return { ok: true, authPolicyId: policyId };
    },
  );
  app.put(
    "/api/runtime-endpoints/:endpointId/auth-policies/order",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin"]);
      const { endpointId } = request.params as { endpointId: string };
      const { policyIds } = parse(authPolicyOrderSchema, request.body);
      if (new Set(policyIds).size !== policyIds.length)
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Authentication policy order contains duplicates",
            requestId: requestId(request),
          },
        });
      const endpoint = await prisma.runtimeEndpoint.findFirst({
        where: { id: endpointId, projectId: session.projectId },
        include: { authPolicyAssignments: true },
      });
      const assigned = new Set(
        endpoint?.authPolicyAssignments.map((item) => item.authPolicyId) ?? [],
      );
      if (
        !endpoint ||
        assigned.size !== policyIds.length ||
        policyIds.some((id) => !assigned.has(id))
      )
        return reply.status(409).send({
          error: {
            code: "AUTH_POLICY_ORDER_MISMATCH",
            message: "Order every authentication policy assigned to this endpoint",
            requestId: requestId(request),
          },
        });
      await prisma.$transaction(async (tx) => {
        for (const [position, authPolicyId] of policyIds.entries())
          await tx.endpointAuthPolicy.update({
            where: { endpointId_authPolicyId: { endpointId, authPolicyId } },
            data: { position },
          });
        await tx.runtimeEndpoint.update({
          where: { id: endpointId },
          data: { defaultAuthPolicyId: policyIds[0] },
        });
        await tx.auditEvent.create({
          data: {
            projectId: session.projectId,
            endpointId,
            actorType: "user",
            actorId: session.userId,
            action: "auth_policy.reordered",
            targetType: "runtime_endpoint",
            targetId: endpointId,
            metadata: { policyIds },
          },
        });
      });
      return { ok: true, policyIds };
    },
  );
  app.delete(
    "/api/runtime-endpoints/:endpointId/auth-policies/:policyId",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin"]);
      const { endpointId, policyId } = request.params as {
        endpointId: string;
        policyId: string;
      };
      const assignment = await prisma.endpointAuthPolicy.findFirst({
        where: {
          endpointId,
          authPolicyId: policyId,
          endpoint: { projectId: session.projectId },
        },
        include: { authPolicy: true },
      });
      if (!assignment)
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Authentication policy not found",
            requestId: requestId(request),
          },
        });
      await prisma.$transaction(async (tx) => {
        await tx.endpointAuthPolicy.delete({ where: { id: assignment.id } });
        const remaining = await tx.endpointAuthPolicy.findMany({
          where: { endpointId },
          orderBy: { position: "asc" },
        });
        for (const [position, item] of remaining.entries())
          await tx.endpointAuthPolicy.update({
            where: { id: item.id },
            data: { position },
          });
        await tx.runtimeEndpoint.update({
          where: { id: endpointId },
          data: { defaultAuthPolicyId: remaining[0]?.authPolicyId ?? null },
        });
        await tx.auditEvent.create({
          data: {
            projectId: session.projectId,
            endpointId,
            actorType: "user",
            actorId: session.userId,
            action: "auth_policy.removed",
            targetType: "auth_policy",
            targetId: policyId,
            metadata: {
              name: assignment.authPolicy.name,
              type: assignment.authPolicy.type,
            },
          },
        });
      });
      return reply.status(204).send();
    },
  );
}
