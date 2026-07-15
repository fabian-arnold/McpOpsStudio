import type { FastifyReply } from "fastify";
import { prisma } from "@mcpops/db";
import type { PlatformSession } from "./auth.js";
import { networkPolicyWarnings, providerStatus } from "./control-plane-validation.js";
import { normalizeFunctionBindings } from "./function-view.js";
import { cacheInspector } from "./resources.js";
import { stringList } from "./api-value-helpers.js";

export function replyCsv(reply: FastifyReply, content: string, filename: string) {
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename=${JSON.stringify(filename)}`)
    .send(content);
}

export async function assertScopedCursor(
  kind: "execution" | "deployment" | "audit" | "runtime_log",
  projectId: string,
  id: string,
): Promise<void> {
  const found =
    kind === "runtime_log"
      ? await prisma.runtimeLog.findFirst({
          where: { id, projectId },
          select: { id: true },
        })
      : kind === "execution"
        ? await prisma.functionExecution.findFirst({
            where: { id, projectId },
            select: { id: true },
          })
        : kind === "deployment"
          ? await prisma.projectDeployment.findFirst({
              where: { id, projectId },
              select: { id: true },
            })
          : await prisma.auditEvent.findFirst({
              where: { id, projectId },
              select: { id: true },
            });
  if (!found)
    throw Object.assign(new Error("Pagination cursor is invalid for this project"), {
      statusCode: 400,
      code: "INVALID_CURSOR",
    });
}

export function functionView<
  T extends {
    grants: Array<{
      secretName: string;
      secret?: { id: string; name: string } | null;
    }>;
    mcpToolBindings?: Array<{
      id: string;
      functionId: string;
      toolName: string;
      title: string;
      description: string;
      enabled: boolean;
      endpoint: { id: string; name: string; slug: string; kind: "mcp" | "http" };
    }>;
    httpRouteBindings?: Array<{
      id: string;
      functionId: string;
      method: string;
      path: string;
      inputMapping?: unknown;
      responseMapping?: unknown;
      enabled: boolean;
      endpoint: { id: string; name: string; slug: string; kind: "mcp" | "http" };
    }>;
  },
>(fn: T, includeBindings = false) {
  const { grants, mcpToolBindings = [], httpRouteBindings = [], ...functionData } = fn;
  return {
    ...functionData,
    secretGrants: grants.map((grant) => ({
      ...(grant.secret ? { secretId: grant.secret.id } : {}),
      name: grant.secretName,
    })),
    ...(includeBindings
      ? normalizeFunctionBindings(mcpToolBindings, httpRouteBindings)
      : {}),
  };
}

export function policyView<T extends { type: string }>(policy: T) {
  return {
    ...policy,
    providerStatus: providerStatus(policy.type),
    mutable: providerStatus(policy.type) === "enabled",
  };
}

export function networkPolicyView(
  policy: {
    id: string;
    allowedHosts: unknown;
    allowedMethods: unknown;
    allowedPorts: unknown;
    allowPrivateHosts: unknown;
    maxResponseBytes: number;
    updatedAt?: Date;
  } | null,
) {
  const allowedHosts = stringList(policy?.allowedHosts);
  const allowedMethods = stringList(policy?.allowedMethods);
  const allowedPorts = Array.isArray(policy?.allowedPorts)
    ? policy.allowedPorts.filter((port): port is number => typeof port === "number")
    : [];
  const allowPrivateHosts = stringList(policy?.allowPrivateHosts);
  const exactPolicy = {
    allowedHosts,
    allowedMethods,
    allowedPorts,
    maxResponseBytes: policy?.maxResponseBytes ?? 1_048_576,
    allowPrivateHosts,
  };
  return {
    id: policy?.id,
    ...exactPolicy,
    warnings: networkPolicyWarnings(allowedHosts, allowPrivateHosts),
    nextSnapshotPolicy: exactPolicy,
    updatedAt: policy?.updatedAt,
    configured: Boolean(policy),
  };
}

export async function validatePolicySecretIfRequired(
  projectId: string,
  environmentId: string,
  config: object,
): Promise<void> {
  if (!("secretRef" in config) || typeof config.secretRef !== "string") return;
  const secretRef = config.secretRef;
  const secret = await prisma.secret.findFirst({
    where: { projectId, environmentId, name: secretRef },
    select: { id: true, encryptedValue: true },
  });
  if (!secret?.encryptedValue)
    throw Object.assign(
      new Error(
        "Authentication policy secretRef must name a secret in the endpoint environment",
      ),
      {
        statusCode: 400,
        code: "INVALID_POLICY_SECRET_REF",
      },
    );
}

export async function validateBindingReferences(
  projectId: string,
  endpointId: string,
  functionId: string,
  expectedKind: "mcp" | "http",
): Promise<void> {
  const [fn, endpoint] = await Promise.all([
    prisma.function.findFirst({
      where: { id: functionId, projectId },
      select: { id: true },
    }),
    prisma.runtimeEndpoint.findFirst({
      where: { id: endpointId, projectId, kind: expectedKind },
      select: { id: true },
    }),
  ]);
  if (!fn)
    throw Object.assign(
      new Error("The selected function does not belong to this project"),
      {
        statusCode: 400,
        code: "INVALID_BINDING_FUNCTION",
      },
    );
  if (!endpoint)
    throw Object.assign(
      new Error(`A ${expectedKind.toUpperCase()} endpoint is required`),
      {
        statusCode: 400,
        code: "ENDPOINT_KIND_MISMATCH",
      },
    );
}

export async function writeControlAudit(
  session: PlatformSession,
  endpointId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      projectId: session.projectId,
      endpointId,
      actorType: "user",
      actorId: session.userId,
      action,
      targetType,
      targetId,
      metadata: metadata as never,
    },
  });
}

export async function setEndpointEnabled(
  session: PlatformSession,
  endpointId: string,
  enabled: boolean,
) {
  const endpoint = await prisma.runtimeEndpoint.findFirst({
    where: { id: endpointId, projectId: session.projectId },
  });
  if (!endpoint)
    throw Object.assign(new Error("Runtime endpoint not found"), {
      statusCode: 404,
      code: "NOT_FOUND",
    });
  const status = enabled
    ? endpoint.activeDeploymentId
      ? "deployed"
      : "draft"
    : "disabled";
  await prisma.runtimeEndpoint.update({
    where: { id: endpointId },
    data: { status },
  });
  await prisma.auditEvent.create({
    data: {
      projectId: session.projectId,
      environmentId: endpoint.environmentId,
      endpointId,
      actorType: "user",
      actorId: session.userId,
      action: enabled ? "endpoint.enabled" : "endpoint.disabled",
      targetType: "runtime_endpoint",
      targetId: endpointId,
      metadata: { name: endpoint.name, slug: endpoint.slug, status },
    },
  });
  return { ok: true, status };
}

export async function purgeFunctionCache(
  projectId: string,
  environmentId: string,
): Promise<number> {
  const pattern = `mcpops:${projectId}:${environmentId}:*`;
  if (cacheInspector.status === "wait") await cacheInspector.connect();
  let cursor = "0";
  let scans = 0;
  const matchedKeys: string[] = [];
  do {
    const [nextCursor, keys] = await cacheInspector.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      500,
    );
    cursor = nextCursor;
    scans += 1;
    matchedKeys.push(...keys);
    if (scans > 10_000 || matchedKeys.length > 100_000)
      throw Object.assign(
        new Error(
          "Cache purge exceeded the safe inspection limit before making changes",
        ),
        {
          statusCode: 503,
          code: "CACHE_PURGE_LIMIT",
        },
      );
  } while (cursor !== "0");
  let purged = 0;
  for (let index = 0; index < matchedKeys.length; index += 500)
    purged += await cacheInspector.unlink(...matchedKeys.slice(index, index + 500));
  return purged;
}

export async function inspectStorageMetadata(projectId: string, environmentId: string) {
  const now = new Date();
  const scope = { namespace: { projectId, environmentId } };
  const [namespaces, storedKeys, activeKeys, expiredKeys] = await Promise.all([
    prisma.storageNamespace.count({ where: { projectId, environmentId } }),
    prisma.storageEntry.count({ where: scope }),
    prisma.storageEntry.count({
      where: {
        ...scope,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    prisma.storageEntry.count({ where: { ...scope, expiresAt: { lte: now } } }),
  ]);
  return {
    namespaces,
    storedKeys,
    activeKeys,
    expiredKeys,
    valuesExposed: false,
  };
}

export async function inspectCacheMetadata(projectId: string, environmentId: string) {
  const pattern = `mcpops:${projectId}:${environmentId}:*`;
  try {
    if (cacheInspector.status === "wait") await cacheInspector.connect();
    let cursor = "0";
    let activeKeys = 0;
    let scans = 0;
    do {
      const [nextCursor, keys] = await cacheInspector.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        500,
      );
      cursor = nextCursor;
      activeKeys += keys.length;
      scans += 1;
      if (scans > 10_000)
        return {
          status: "partial" as const,
          activeKeys,
          approximate: true,
          hitRate: null,
          hitRateAvailable: false,
          keyMaterialExposed: false,
        };
    } while (cursor !== "0");
    return {
      status: "available" as const,
      activeKeys,
      approximate: true,
      hitRate: null,
      hitRateAvailable: false,
      keyMaterialExposed: false,
    };
  } catch {
    return {
      status: "unavailable" as const,
      activeKeys: null,
      approximate: false,
      hitRate: null,
      hitRateAvailable: false,
      keyMaterialExposed: false,
    };
  }
}

export async function probeRedisDependency(): Promise<"healthy" | "unavailable"> {
  try {
    if (cacheInspector.status === "wait") await cacheInspector.connect();
    return (await cacheInspector.ping()) === "PONG" ? "healthy" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function probeRuntimeEndpoint(endpointId: string) {
  const checkedAt = new Date();
  const base = (process.env.RUNTIME_INTERNAL_URL ?? "http://localhost:8080").replace(
    /\/+$/,
    "",
  );
  try {
    const response = await fetch(
      `${base}/internal/runtime-endpoints/${encodeURIComponent(endpointId)}/manifest`,
      {
        headers: process.env.INTERNAL_API_TOKEN
          ? { "x-internal-token": process.env.INTERNAL_API_TOKEN }
          : {},
        signal: AbortSignal.timeout(2_000),
      },
    );
    return {
      status: response.ok ? ("healthy" as const) : ("degraded" as const),
      reachable: true,
      activeDeploymentLoadable: response.ok,
      statusCode: response.status,
      checkedAt,
    };
  } catch {
    return {
      status: "unavailable" as const,
      reachable: false,
      activeDeploymentLoadable: false,
      checkedAt,
    };
  }
}
