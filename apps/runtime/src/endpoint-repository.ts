import { deploymentSnapshotSchema, type LoadedEndpoint } from "./domain.js";
import { client } from "./repository-client.js";
import { logSettings } from "./execution-repository.js";

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
    logLevel?: string;
    logRetentionDays?: number;
    logRetentionMaxEntries?: number;
    logRetentionMaxBytes?: number;
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
  const parsed = deploymentSnapshotSchema.safeParse(row.activeDeployment.snapshot);
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
      ...logSettings(row.environment),
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
  logLevel?: string;
  logRetentionDays?: number;
  logRetentionMaxEntries?: number;
  logRetentionMaxBytes?: number;
  activeProjectDeployment: { snapshot: unknown } | null;
};

async function environmentForHost(
  projectId: string,
  requestHost?: string,
  environmentSlug?: string,
): Promise<ReleasedEnvironmentRow | null> {
  if ((!requestHost && !environmentSlug) || !client.environment.findMany) return null;
  const environments = (await client.environment.findMany({
    where: { projectId },
    include: { activeProjectDeployment: true },
  })) as ReleasedEnvironmentRow[];
  if (environmentSlug)
    return (
      environments.find((environment) => environment.slug === environmentSlug) ?? null
    );
  return (
    environments.find((environment) => {
      try {
        return (
          new URL(environment.baseUrl).host.toLowerCase() === requestHost?.toLowerCase()
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
        environment.slug === "development" && environment.capturePayloads === true,
      ...logSettings(environment),
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
  })) as { encryptedValue: string | null } | null;
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
  })) as { encryptedValue: string | null } | null;
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
    if (!row.activeDeployment) throw new Error("An active endpoint has no deployment");
    const parsed = deploymentSnapshotSchema.safeParse(row.activeDeployment.snapshot);
    if (!parsed.success) throw new Error("An active deployment snapshot is invalid");
  }
  return rows.length;
}
