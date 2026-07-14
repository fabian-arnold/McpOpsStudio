import { type FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import { authPolicyMutationSchema } from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";
import { policyView, validatePolicySecretIfRequired } from "./api-operation-helpers.js";
import { providerStatus } from "./control-plane-validation.js";

export async function registerAuthPoliciesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/auth-policies", async (request) => {
    const session = sessionContext(request);
    return prisma.authPolicy
      .findMany({
        where: { projectId: session.projectId },
        include: {
          endpointAssignments: {
            include: {
              endpoint: { select: { id: true, name: true, kind: true } },
            },
            orderBy: { position: "asc" },
          },
        },
        orderBy: { name: "asc" },
      })
      .then((policies) =>
        policies.map((policy) => ({
          ...policyView(policy),
          assignments: policy.endpointAssignments.map((assignment) => ({
            endpointId: assignment.endpoint.id,
            endpointName: assignment.endpoint.name,
            endpointKind: assignment.endpoint.kind,
            position: assignment.position,
          })),
        })),
      );
  });
  app.post("/api/auth-policies", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const input = parse(authPolicyMutationSchema, request.body);
    const conflict = await prisma.authPolicy.findFirst({
      where: { projectId: session.projectId, name: input.name },
      select: { id: true },
    });
    if (conflict)
      return reply.status(409).send({
        error: {
          code: "AUTH_POLICY_NAME_CONFLICT",
          message: "An authentication policy with this name already exists",
          requestId: requestId(request),
        },
      });
    const created = await prisma.$transaction(async (tx) => {
      const policy = await tx.authPolicy.create({
        data: { projectId: session.projectId, ...input } as never,
      });
      await tx.auditEvent.create({
        data: {
          projectId: session.projectId,
          actorType: "user",
          actorId: session.userId,
          action: "auth_policy.created",
          targetType: "auth_policy",
          targetId: policy.id,
          metadata: { name: policy.name, type: policy.type },
        },
      });
      return policy;
    });
    return reply.status(201).send(policyView(created));
  });
  app.get("/api/auth-policies/:policyId", async (request, reply) => {
    const session = sessionContext(request);
    const { policyId } = request.params as { policyId: string };
    const policy = await prisma.authPolicy.findFirst({
      where: { id: policyId, projectId: session.projectId },
      include: {
        endpointAssignments: {
          include: {
            endpoint: {
              select: {
                id: true,
                name: true,
                kind: true,
                environment: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { position: "asc" },
        },
      },
    });
    if (!policy)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Authentication policy not found",
          requestId: requestId(request),
        },
      });
    return {
      ...policyView(policy),
      assignments: policy.endpointAssignments.map((assignment) => ({
        endpointId: assignment.endpoint.id,
        endpointName: assignment.endpoint.name,
        endpointKind: assignment.endpoint.kind,
        environment: assignment.endpoint.environment,
        position: assignment.position,
      })),
    };
  });
  app.patch("/api/auth-policies/:policyId", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { policyId } = request.params as { policyId: string };
    const input = parse(authPolicyMutationSchema, request.body);
    const policy = await prisma.authPolicy.findFirst({
      where: { id: policyId, projectId: session.projectId },
      include: {
        endpointAssignments: {
          select: { endpoint: { select: { environmentId: true } } },
        },
      },
    });
    if (!policy)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Authentication policy not found",
          requestId: requestId(request),
        },
      });
    const conflict = await prisma.authPolicy.findFirst({
      where: {
        projectId: session.projectId,
        name: input.name,
        id: { not: policyId },
      },
      select: { id: true },
    });
    if (conflict)
      return reply.status(409).send({
        error: {
          code: "AUTH_POLICY_NAME_CONFLICT",
          message: "An authentication policy with this name already exists",
          requestId: requestId(request),
        },
      });
    const environmentIds = new Set(
      policy.endpointAssignments.map((assignment) => assignment.endpoint.environmentId),
    );
    for (const environmentId of environmentIds)
      await validatePolicySecretIfRequired(
        session.projectId,
        environmentId,
        input.config,
      );
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.authPolicy.update({
        where: { id: policyId },
        data: input as never,
      });
      await tx.auditEvent.create({
        data: {
          projectId: session.projectId,
          actorType: "user",
          actorId: session.userId,
          action: "auth_policy.updated",
          targetType: "auth_policy",
          targetId: policyId,
          metadata: { name: next.name, type: next.type },
        },
      });
      return next;
    });
    return policyView(updated);
  });
  app.delete("/api/auth-policies/:policyId", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { policyId } = request.params as { policyId: string };
    const policy = await prisma.authPolicy.findFirst({
      where: { id: policyId, projectId: session.projectId },
      include: { _count: { select: { endpointAssignments: true } } },
    });
    if (!policy)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Authentication policy not found",
          requestId: requestId(request),
        },
      });
    if (policy._count.endpointAssignments)
      return reply.status(409).send({
        error: {
          code: "AUTH_POLICY_IN_USE",
          message: "Remove this policy from every endpoint before deleting it",
          requestId: requestId(request),
        },
      });
    await prisma.$transaction([
      prisma.authPolicy.delete({ where: { id: policyId } }),
      prisma.auditEvent.create({
        data: {
          projectId: session.projectId,
          actorType: "user",
          actorId: session.userId,
          action: "auth_policy.deleted",
          targetType: "auth_policy",
          targetId: policyId,
          metadata: { name: policy.name, type: policy.type },
        },
      }),
    ]);
    return reply.status(204).send();
  });
  app.get("/api/auth-policy-providers", async () =>
    [
      "public",
      "api_key",
      "bearer_token",
      "basic_auth",
      "jwt",
      "oidc",
      "entra_id",
      "webhook_signature",
    ].map((type) => ({
      type,
      status: providerStatus(type),
    })),
  );
}
