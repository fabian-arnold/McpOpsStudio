import { z } from "zod";
import { prisma } from "@mcpops/db";
import type { AuthPolicy } from "@prisma/client";
import { authPolicyMutationSchema, networkPolicyUpdateSchema } from "@mcpops/shared";
import {
  networkPolicyView,
  policyView,
  validatePolicyFunctionIfRequired,
  validatePolicySecretIfRequired,
} from "./api-operation-helpers.js";
import { networkPolicyWarnings } from "./control-plane-validation.js";
import { record } from "./api-value-helpers.js";

type Actor = { userId: string; role: string; scopes: string[] };

const identifierSchema = z.object({ policy: z.string().min(1) }).strict();
const createSchema = z.object({ definition: authPolicyMutationSchema }).strict();
const editSchema = z
  .object({ policy: z.string().min(1), definition: authPolicyMutationSchema })
  .strict();
const assignSchema = z
  .object({ endpoint: z.string().min(1), policies: z.array(z.string().min(1)).max(20) })
  .strict();
const endpointSchema = z.object({ endpoint: z.string().min(1) }).strict();
const networkEditSchema = z
  .object({ endpoint: z.string().min(1), policy: networkPolicyUpdateSchema })
  .strict();

export const policyToolNames = new Set([
  "auth_policies_list",
  "auth_policy_get",
  "auth_policy_create",
  "auth_policy_edit",
  "auth_policy_delete",
  "endpoint_auth_assign",
  "network_policy_get",
  "network_policy_edit",
]);

export async function callPolicyTool(
  name: string,
  projectId: string,
  actor: Actor,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (name === "auth_policies_list") return listPolicies(projectId);
  if (name === "auth_policy_get")
    return getPolicy(projectId, identifierSchema.parse(args).policy);
  if (name === "network_policy_get")
    return getNetworkPolicy(projectId, endpointSchema.parse(args).endpoint);
  requireOwnerWrite(actor);
  if (name === "auth_policy_create")
    return createPolicy(projectId, actor, createSchema.parse(args).definition);
  if (name === "auth_policy_edit")
    return editPolicy(projectId, actor, editSchema.parse(args));
  if (name === "auth_policy_delete")
    return deletePolicy(projectId, actor, identifierSchema.parse(args).policy);
  if (name === "endpoint_auth_assign")
    return assignEndpointPolicies(projectId, actor, assignSchema.parse(args));
  if (name === "network_policy_edit")
    return editNetworkPolicy(projectId, actor, networkEditSchema.parse(args));
  throw error("UNKNOWN_TOOL", `Unknown policy tool: ${name}`);
}

async function listPolicies(projectId: string) {
  const policies = await prisma.authPolicy.findMany({
    where: { projectId },
    include: {
      endpointAssignments: {
        include: {
          endpoint: { select: { id: true, name: true, slug: true, kind: true } },
        },
        orderBy: { position: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
  return output("Authentication policies", {
    policies: policies.map((policy) => ({
      ...policyView(policy),
      endpointAssignments: policy.endpointAssignments.map((assignment) => ({
        endpoint: assignment.endpoint,
        position: assignment.position,
      })),
    })),
    containsSecretValues: false,
  });
}

async function getPolicy(projectId: string, identifier: string) {
  const policy = await findPolicy(projectId, identifier);
  const assignments = await prisma.endpointAuthPolicy.findMany({
    where: { authPolicyId: policy.id },
    include: {
      endpoint: {
        select: {
          id: true,
          name: true,
          slug: true,
          kind: true,
          environment: { select: { id: true, name: true, slug: true } },
        },
      },
    },
    orderBy: { position: "asc" },
  });
  return output(policy.name, {
    policy: {
      ...policyView(policy),
      endpointAssignments: assignments.map((assignment) => ({
        endpoint: assignment.endpoint,
        position: assignment.position,
      })),
    },
    containsSecretValues: false,
  });
}

async function createPolicy(
  projectId: string,
  actor: Actor,
  definition: z.infer<typeof authPolicyMutationSchema>,
) {
  await validatePolicyFunctionIfRequired(projectId, definition.config);
  if (await prisma.authPolicy.count({ where: { projectId, name: definition.name } }))
    throw error("AUTH_POLICY_NAME_CONFLICT", "Policy name already exists", 409);
  const policy = await prisma.$transaction(async (tx) => {
    const created = await tx.authPolicy.create({
      data: { projectId, ...definition } as never,
    });
    await tx.auditEvent.create({
      data: {
        projectId,
        actorType: "user",
        actorId: actor.userId,
        action: "auth_policy.created",
        targetType: "auth_policy",
        targetId: created.id,
        metadata: { name: created.name, type: created.type, source: "platform_mcp" },
      },
    });
    return created;
  });
  return output(`Created ${policy.name}`, {
    policy: policyView(policy),
    containsSecretValues: false,
  });
}

async function editPolicy(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof editSchema>,
) {
  const current = await findPolicy(projectId, input.policy);
  await validatePolicyFunctionIfRequired(projectId, input.definition.config);
  const assignments = await prisma.endpointAuthPolicy.findMany({
    where: { authPolicyId: current.id },
    select: { endpoint: { select: { environmentId: true } } },
  });
  if (
    await prisma.authPolicy.count({
      where: { projectId, name: input.definition.name, id: { not: current.id } },
    })
  )
    throw error("AUTH_POLICY_NAME_CONFLICT", "Policy name already exists", 409);
  for (const environmentId of new Set(
    assignments.map((assignment) => assignment.endpoint.environmentId),
  ))
    await validatePolicySecretIfRequired(
      projectId,
      environmentId,
      input.definition.config,
    );
  const policy = await prisma.$transaction(async (tx) => {
    const updated = await tx.authPolicy.update({
      where: { id: current.id },
      data: input.definition as never,
    });
    await tx.auditEvent.create({
      data: {
        projectId,
        actorType: "user",
        actorId: actor.userId,
        action: "auth_policy.updated",
        targetType: "auth_policy",
        targetId: current.id,
        metadata: { name: updated.name, type: updated.type, source: "platform_mcp" },
      },
    });
    return updated;
  });
  return output(`Updated ${policy.name}`, {
    policy: policyView(policy),
    containsSecretValues: false,
  });
}

async function deletePolicy(projectId: string, actor: Actor, identifier: string) {
  const policy = await findPolicy(projectId, identifier);
  const [assignments, defaults] = await Promise.all([
    prisma.endpointAuthPolicy.count({ where: { authPolicyId: policy.id } }),
    prisma.runtimeEndpoint.count({ where: { defaultAuthPolicyId: policy.id } }),
  ]);
  if (assignments || defaults)
    throw error(
      "AUTH_POLICY_IN_USE",
      "Remove this policy from every endpoint before deleting it",
      409,
    );
  await prisma.$transaction([
    prisma.authPolicy.delete({ where: { id: policy.id } }),
    prisma.auditEvent.create({
      data: {
        projectId,
        actorType: "user",
        actorId: actor.userId,
        action: "auth_policy.deleted",
        targetType: "auth_policy",
        targetId: policy.id,
        metadata: { name: policy.name, type: policy.type, source: "platform_mcp" },
      },
    }),
  ]);
  return output(`Deleted ${policy.name}`, { id: policy.id, deleted: true });
}

async function assignEndpointPolicies(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof assignSchema>,
) {
  const endpoint = await findEndpoint(projectId, input.endpoint);
  const identifiers = [...new Set(input.policies)];
  if (identifiers.length !== input.policies.length)
    throw error("VALIDATION_ERROR", "Policy order contains duplicates");
  const policies: AuthPolicy[] = [];
  for (const identifier of identifiers) {
    const policy = await findPolicy(projectId, identifier);
    await validatePolicySecretIfRequired(
      projectId,
      endpoint.environmentId,
      record(policy.config),
    );
    await validatePolicyFunctionIfRequired(projectId, record(policy.config));
    policies.push(policy);
  }
  await prisma.$transaction(async (tx) => {
    await tx.endpointAuthPolicy.deleteMany({ where: { endpointId: endpoint.id } });
    if (policies.length)
      await tx.endpointAuthPolicy.createMany({
        data: policies.map((policy, position) => ({
          endpointId: endpoint.id,
          authPolicyId: policy.id,
          position,
        })),
      });
    await tx.runtimeEndpoint.update({
      where: { id: endpoint.id },
      data: { defaultAuthPolicyId: policies[0]?.id ?? null },
    });
    await tx.auditEvent.create({
      data: {
        projectId,
        endpointId: endpoint.id,
        actorType: "user",
        actorId: actor.userId,
        action: "auth_policy.assignments_replaced",
        targetType: "runtime_endpoint",
        targetId: endpoint.id,
        metadata: {
          policyIds: policies.map((policy) => policy.id),
          source: "platform_mcp",
        },
      },
    });
  });
  return output(`Updated authentication for ${endpoint.name}`, {
    endpoint: { id: endpoint.id, name: endpoint.name, slug: endpoint.slug },
    policies: policies.map((policy, position) => ({
      id: policy.id,
      name: policy.name,
      type: policy.type,
      position,
      default: position === 0,
    })),
  });
}

async function getNetworkPolicy(projectId: string, identifier: string) {
  const endpoint = await findEndpoint(projectId, identifier);
  const policy = await prisma.networkPolicy.findUnique({
    where: { endpointId: endpoint.id },
  });
  return output(`${endpoint.name} network policy`, {
    endpoint: { id: endpoint.id, name: endpoint.name, slug: endpoint.slug },
    policy: networkPolicyView(policy),
  });
}

async function editNetworkPolicy(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof networkEditSchema>,
) {
  const endpoint = await findEndpoint(projectId, input.endpoint);
  const policy = await prisma.$transaction(async (tx) => {
    const updated = await tx.networkPolicy.upsert({
      where: { endpointId: endpoint.id },
      create: { projectId, endpointId: endpoint.id, ...input.policy },
      update: input.policy,
    });
    await tx.auditEvent.create({
      data: {
        projectId,
        endpointId: endpoint.id,
        actorType: "user",
        actorId: actor.userId,
        action: "network_policy.updated",
        targetType: "network_policy",
        targetId: updated.id,
        metadata: {
          allowedHosts: input.policy.allowedHosts,
          allowedMethods: input.policy.allowedMethods,
          allowedPorts: input.policy.allowedPorts,
          allowPrivateHosts: input.policy.allowPrivateHosts,
          allowInsecureTlsHosts: input.policy.allowInsecureTlsHosts,
          maxResponseBytes: input.policy.maxResponseBytes,
          warningCodes: networkPolicyWarnings(
            input.policy.allowedHosts,
            input.policy.allowPrivateHosts,
            input.policy.allowInsecureTlsHosts,
          ).map((warning) => warning.code),
          source: "platform_mcp",
        },
      },
    });
    return updated;
  });
  return output(`Updated ${endpoint.name} network policy`, {
    endpoint: { id: endpoint.id, name: endpoint.name, slug: endpoint.slug },
    policy: networkPolicyView(policy),
  });
}

async function findEndpoint(projectId: string, identifier: string) {
  const endpoint = await prisma.runtimeEndpoint.findFirst({
    where: {
      projectId,
      OR: identifierWhere(identifier, "slug", "name"),
    },
    select: { id: true, name: true, slug: true, environmentId: true },
  });
  if (!endpoint) throw error("NOT_FOUND", "Endpoint not found", 404);
  return endpoint;
}

async function findPolicy(projectId: string, identifier: string): Promise<AuthPolicy> {
  const policy = await prisma.authPolicy.findFirst({
    where: { projectId, OR: identifierWhere(identifier, "name") },
  });
  if (!policy) throw error("NOT_FOUND", "Authentication policy not found", 404);
  return policy;
}

function identifierWhere(identifier: string, ...textFields: string[]) {
  return [
    ...(z.string().uuid().safeParse(identifier).success ? [{ id: identifier }] : []),
    ...textFields.map((field) => ({ [field]: identifier })),
  ];
}

function requireOwnerWrite(actor: Actor) {
  if (!actor.scopes.includes("mcpops:write"))
    throw error("INSUFFICIENT_SCOPE", "OAuth scope mcpops:write is required", 403);
  if (!["owner", "admin"].includes(actor.role))
    throw error("FORBIDDEN", `Role ${actor.role} cannot perform this operation`, 403);
}
function error(code: string, message: string, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
function output(summary: string, data: unknown) {
  return { ok: true, summary, data, warnings: [], diagnostics: [], nextActions: [] };
}
