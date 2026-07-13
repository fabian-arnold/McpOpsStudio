import { prisma } from "@mcpops/db";
import { deploymentSnapshotSchema, type LoadedEndpoint } from "./domain.js";

type Delegate = {
  findFirst(args: unknown): Promise<unknown>;
  findMany?(args: unknown): Promise<unknown>;
  findUnique?(args: unknown): Promise<unknown>;
  create(args: unknown): Promise<unknown>;
  upsert?(args: unknown): Promise<unknown>;
  delete?(args: unknown): Promise<unknown>;
};
type RuntimePrisma = {
  runtimeEndpoint: Delegate;
  secret: Delegate;
  functionExecution: Delegate;
  auditEvent: Delegate;
  storageNamespace: Delegate;
  storageEntry: Delegate;
  environment: Delegate;
};
const client = prisma as unknown as RuntimePrisma;

type EndpointRow = {
  id: string;
  name: string;
  slug: string;
  kind: "mcp" | "http";
  project: { id: string; name: string; slug: string };
  environment: {
    id: string;
    name: string;
    slug: string;
    capturePayloads?: boolean;
  };
  activeDeployment: {
    id: string;
    version: number;
    checksum: string;
    snapshot: unknown;
  } | null;
};

export async function loadEndpoint(
  projectSlug: string,
  endpointSlug: string,
  kind: "mcp" | "http",
  requestHost?: string,
  environmentSlug?: string,
): Promise<LoadedEndpoint | null> {
  const row = (await client.runtimeEndpoint.findFirst({
    where: {
      slug: endpointSlug,
      kind,
      project: { slug: projectSlug },
      status: { not: "disabled" },
    },
    include: { project: true, environment: true, activeDeployment: true },
  })) as EndpointRow | null;
  if (!row) return null;
  const selectedEnvironment = await environmentForHost(
    row.project.id,
    requestHost,
    environmentSlug,
  );
  if (selectedEnvironment && selectedEnvironment.id !== row.environment.id)
    return normalizeReleasedEndpoint(row, selectedEnvironment);
  return normalizeEndpoint(row);
}
export async function loadEndpointById(
  endpointId: string,
): Promise<LoadedEndpoint | null> {
  const row = (await client.runtimeEndpoint.findFirst({
    where: { id: endpointId },
    include: { project: true, environment: true, activeDeployment: true },
  })) as EndpointRow | null;
  return normalizeEndpoint(row);
}
function normalizeEndpoint(row: EndpointRow | null): LoadedEndpoint | null {
  if (!row?.activeDeployment) return null;
  const parsed = deploymentSnapshotSchema.safeParse(
    row.activeDeployment.snapshot,
  );
  if (!parsed.success)
    throw new Error(
      `Active deployment snapshot is invalid: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    project: row.project,
    environment: {
      ...row.environment,
      capturePayloads:
        row.environment.slug === "development" &&
        row.environment.capturePayloads === true,
    },
    deployment: {
      id: row.activeDeployment.id,
      version: row.activeDeployment.version,
      checksum: row.activeDeployment.checksum,
    },
    snapshot: parsed.data,
  };
}

type ReleasedEnvironmentRow = {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  capturePayloads?: boolean;
  activeProjectDeployment: { snapshot: unknown } | null;
};

async function environmentForHost(
  projectId: string,
  requestHost?: string,
  environmentSlug?: string,
): Promise<ReleasedEnvironmentRow | null> {
  if ((!requestHost && !environmentSlug) || !client.environment.findMany)
    return null;
  const environments = (await client.environment.findMany({
    where: { projectId },
    include: { activeProjectDeployment: true },
  })) as ReleasedEnvironmentRow[];
  if (environmentSlug)
    return (
      environments.find((environment) => environment.slug === environmentSlug) ??
      null
    );
  return (
    environments.find((environment) => {
      try {
        return (
          new URL(environment.baseUrl).host.toLowerCase() ===
          requestHost?.toLowerCase()
        );
      } catch {
        return false;
      }
    }) ?? null
  );
}

function normalizeReleasedEndpoint(
  row: EndpointRow,
  environment: ReleasedEnvironmentRow,
): LoadedEndpoint | null {
  if (!environment.activeProjectDeployment) return null;
  const projectSnapshot = asRecord(environment.activeProjectDeployment.snapshot);
  const artifacts = Array.isArray(projectSnapshot.endpoints)
    ? projectSnapshot.endpoints.map(asRecord)
    : [];
  const artifact = artifacts.find((candidate) => {
    const endpoint = asRecord(candidate.endpoint);
    return endpoint.slug === row.slug && endpoint.kind === row.kind;
  });
  if (!artifact) return null;
  const parsed = deploymentSnapshotSchema.safeParse(artifact.snapshot);
  if (!parsed.success)
    throw new Error(
      `Released deployment snapshot is invalid: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    project: row.project,
    environment: {
      id: environment.id,
      name: environment.name,
      slug: environment.slug,
      capturePayloads:
        environment.slug === "development" &&
        environment.capturePayloads === true,
    },
    deployment: {
      id: String(artifact.deploymentId),
      version: Number(artifact.version),
      checksum: String(artifact.checksum),
    },
    snapshot: parsed.data,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function getEncryptedSecret(
  endpoint: LoadedEndpoint,
  name: string,
): Promise<string | null> {
  const row = (await client.secret.findFirst({
    where: {
      projectId: endpoint.project.id,
      environmentId: endpoint.environment.id,
      name,
    },
    select: { encryptedValue: true },
  })) as { encryptedValue: string } | null;
  return row?.encryptedValue ?? null;
}

/** Resolves an immutable snapshot reference without trusting a caller-provided project or environment. */
export async function getEncryptedSecretById(
  endpoint: LoadedEndpoint,
  secretId: string,
): Promise<string | null> {
  const row = (await client.secret.findFirst({
    where: {
      id: secretId,
      projectId: endpoint.project.id,
      environmentId: endpoint.environment.id,
    },
    select: { encryptedValue: true },
  })) as { encryptedValue: string } | null;
  return row?.encryptedValue ?? null;
}

export async function probeDatabase(): Promise<void> {
  await client.runtimeEndpoint.findFirst({ select: { id: true } });
}
export async function countAndValidateActiveDeployments(): Promise<number> {
  if (!client.runtimeEndpoint.findMany)
    throw new Error("Endpoint readiness adapter is unavailable");
  const rows = (await client.runtimeEndpoint.findMany({
    where: { activeDeploymentId: { not: null }, status: { not: "disabled" } },
    select: { activeDeployment: { select: { snapshot: true } } },
  })) as Array<{ activeDeployment: { snapshot: unknown } | null }>;
  for (const row of rows) {
    if (!row.activeDeployment)
      throw new Error("An active endpoint has no deployment");
    const parsed = deploymentSnapshotSchema.safeParse(
      row.activeDeployment.snapshot,
    );
    if (!parsed.success)
      throw new Error("An active deployment snapshot is invalid");
  }
  return rows.length;
}

export type ExecutionRecord = {
  id?: string;
  projectId: string;
  endpointId: string;
  functionId: string;
  functionVersionId: string;
  mcpToolBindingId?: string;
  httpRouteBindingId?: string;
  deploymentId: string;
  requestId: string;
  correlationId?: string;
  invocationSource: string;
  callerIdentity: unknown;
  input: unknown;
  output?: unknown;
  error?: unknown;
  durationMs: number;
  status: string;
  parentExecutionId?: string;
  rootExecutionId?: string;
};
export async function saveExecution(
  record: ExecutionRecord,
): Promise<{ id: string }> {
  return client.functionExecution.create({ data: compact(record) }) as Promise<{
    id: string;
  }>;
}
export async function saveAudit(data: {
  projectId: string;
  environmentId?: string;
  endpointId?: string;
  functionId?: string;
  actorType: string;
  actorId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata: unknown;
}): Promise<void> {
  await client.auditEvent.create({ data: compact(data) });
}

export async function storageGet(
  endpoint: LoadedEndpoint,
  functionId: string,
  tenantScope: string,
  key: string,
): Promise<unknown> {
  const namespace = await ensureStorageNamespace(endpoint);
  const row = (await client.storageEntry.findFirst({
    where: {
      namespaceId: namespace.id,
      functionId,
      tenantScope,
      key,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  })) as { value: unknown } | null;
  return row?.value ?? null;
}
export async function storageSet(
  endpoint: LoadedEndpoint,
  functionId: string,
  tenantScope: string,
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> {
  const namespace = await ensureStorageNamespace(endpoint);
  if (!client.storageEntry.upsert)
    throw new Error("Storage adapter is unavailable");
  await client.storageEntry.upsert({
    where: {
      namespaceId_functionId_tenantScope_key: {
        namespaceId: namespace.id,
        functionId,
        tenantScope,
        key,
      },
    },
    create: {
      namespaceId: namespace.id,
      functionId,
      tenantScope,
      key,
      value,
      expiresAt: ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null,
    },
    update: {
      value,
      expiresAt: ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null,
    },
  });
}
export async function storageDelete(
  endpoint: LoadedEndpoint,
  functionId: string,
  tenantScope: string,
  key: string,
): Promise<void> {
  const namespace = await ensureStorageNamespace(endpoint);
  const found = (await client.storageEntry.findFirst({
    where: { namespaceId: namespace.id, functionId, tenantScope, key },
    select: { id: true },
  })) as { id: string } | null;
  if (found && client.storageEntry.delete)
    await client.storageEntry.delete({ where: { id: found.id } });
}
async function ensureStorageNamespace(
  endpoint: LoadedEndpoint,
): Promise<{ id: string }> {
  const existing = (await client.storageNamespace.findFirst({
    where: {
      projectId: endpoint.project.id,
      environmentId: endpoint.environment.id,
      name: "default",
    },
    select: { id: true },
  })) as { id: string } | null;
  if (existing) return existing;
  return client.storageNamespace.create({
    data: {
      projectId: endpoint.project.id,
      environmentId: endpoint.environment.id,
      name: "default",
    },
    select: { id: true },
  }) as Promise<{ id: string }>;
}
function compact<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}
