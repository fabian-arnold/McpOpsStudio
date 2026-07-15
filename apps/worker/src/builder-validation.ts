import { Ajv } from "ajv";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  type DeploymentSnapshot,
  validateReviewedParameterSchema,
  validateReviewedReadQuery,
  type SnapshotReviewedQuery,
} from "@mcpops/shared";

export function deploymentChecksum(snapshot: unknown): string {
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}

export type ExtendedDeploymentSnapshot = DeploymentSnapshot & {
  endpointAccessPolicy: {
    mode: "authenticated" | "restricted";
    allowedSubjects: string[];
  };
  networkPolicy?: NonNullable<DeploymentSnapshot["networkPolicy"]> & {
    allowPrivateHosts: string[];
    allowInsecureTlsHosts: string[];
  };
};
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
export function validateRuntimeEnvironment(value: unknown): Record<string, string> {
  const input = asRecord(value);
  const output: Record<string, string> = {};
  for (const [name, raw] of Object.entries(input)) {
    if (
      !/^[A-Z][A-Z0-9_]{0,127}$/.test(name) ||
      typeof raw !== "string" ||
      raw.length > 8_192
    )
      throw new Error(`Invalid non-secret runtime environment entry: ${name}`);
    if (/(?:^|_)(?:SECRET|TOKEN|PASSWORD|API_KEY)(?:_|$)/.test(name))
      throw new Error(
        `Secret-like runtime environment entry must use a Secret grant: ${name}`,
      );
    output[name] = raw;
  }
  return output;
}
export function validateCachePolicy(value: unknown): null | Record<string, number> {
  if (value === null || value === undefined) return null;
  const input = asRecord(value);
  const allowed = new Set(["ttlSeconds", "defaultTtlSeconds", "maxTtlSeconds"]);
  for (const name of Object.keys(input))
    if (!allowed.has(name)) throw new Error(`Unsupported cache policy field: ${name}`);
  const output: Record<string, number> = {};
  for (const [name, raw] of Object.entries(input)) {
    if (!Number.isInteger(raw) || Number(raw) < 1 || Number(raw) > 86_400)
      throw new Error(`Invalid cache policy TTL: ${name}`);
    output[name] = Number(raw);
  }
  const defaultTtl = output.defaultTtlSeconds ?? output.ttlSeconds ?? 300;
  const maxTtl = output.maxTtlSeconds ?? 86_400;
  if (defaultTtl > maxTtl)
    throw new Error("Default cache TTL cannot exceed maximum cache TTL");
  return output;
}
export function validateResponseMappingDefinition(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const input = asRecord(value);
  if (!Object.keys(input).length) return {};
  const structured =
    Object.hasOwn(input, "body") ||
    Object.hasOwn(input, "statusCode") ||
    Object.hasOwn(input, "headers");
  if (
    structured &&
    input.statusCode !== undefined &&
    (!Number.isInteger(input.statusCode) ||
      Number(input.statusCode) < 100 ||
      Number(input.statusCode) > 599)
  )
    throw new Error("Invalid HTTP response statusCode mapping");
  const body = structured ? input.body : input;
  if (body !== undefined) validatePathMapping(body, "body");
  if (structured && input.headers !== undefined)
    validatePathMapping(input.headers, "headers");
  return value;
}
function validatePathMapping(value: unknown, label: string): void {
  if (typeof value === "string") {
    if (!value.trim()) throw new Error(`HTTP response ${label} path cannot be empty`);
    return;
  }
  const mapping = asRecord(value);
  if (
    !Object.keys(mapping).length &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    return;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`HTTP response ${label} mapping must be an object or path`);
  for (const [name, expression] of Object.entries(mapping))
    if (!name || typeof expression !== "string" || !expression.trim())
      throw new Error(`Invalid HTTP response ${label} mapping entry`);
}
export function validateEndpointAccessPolicy(
  value: unknown,
): ExtendedDeploymentSnapshot["endpointAccessPolicy"] {
  const input = asRecord(value);
  const mode: "authenticated" | "restricted" =
    input.mode === "restricted" ? "restricted" : "authenticated";
  const policy = { mode, allowedSubjects: stringArray(input.allowedSubjects) };
  if (mode === "restricted" && !policy.allowedSubjects.length)
    throw new Error("Restricted endpoint access requires at least one subject");
  return policy;
}
export function validatePrivateHosts(
  hosts: string[],
  allowedHosts: string[],
): string[] {
  const hardBlocked = new Set([
    "169.254.169.254",
    "100.100.100.200",
    "metadata.google.internal",
    "metadata.azure.com",
  ]);
  for (const host of hosts)
    if (
      !/^[a-z0-9.-]+$/i.test(host) ||
      !allowedHosts.includes(host) ||
      hardBlocked.has(host)
    )
      throw new Error(
        `Private host '${host}' must be a safe exact network-policy allowed host`,
      );
  return [...new Set(hosts)];
}

export function validateInsecureTlsHosts(
  hosts: string[],
  allowedHosts: string[],
): string[] {
  for (const host of hosts)
    if (!/^[a-z0-9.-]+$/i.test(host) || !allowedHosts.includes(host))
      throw new Error(
        `Insecure TLS host '${host}' must be an exact network-policy allowed host`,
      );
  return [...new Set(hosts)];
}

type ReviewedQueryGrantRow = {
  id: string;
  functionId: string;
  queryDefinitionId: string;
  queryVersionId: string;
  queryDefinition: {
    id: string;
    projectId: string;
    environmentId: string;
    queryId: string;
    connection: {
      id: string;
      projectId: string;
      environmentId: string;
      secretId: string;
      name: string;
      enabled: boolean;
      secret: { id: string; projectId: string; environmentId: string };
    };
  };
  queryVersion: {
    id: string;
    queryDefinitionId: string;
    version: number;
    sql: string;
    parameterOrder: unknown;
    parameterSchema: unknown;
    resultSchema: unknown;
    timeoutMs: number;
    maxRows: number;
    maxBytes: number;
    enabled: boolean;
  };
};

export function snapshotReviewedQueries(
  projectId: string,
  environmentId: string,
  rows: readonly ReviewedQueryGrantRow[],
): SnapshotReviewedQuery[] {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const seen = new Set<string>();
  const snapshot = rows.map((grant): SnapshotReviewedQuery => {
    const definition = grant.queryDefinition;
    const version = grant.queryVersion;
    const connection = definition.connection;
    if (
      grant.queryDefinitionId !== definition.id ||
      grant.queryVersionId !== version.id ||
      version.queryDefinitionId !== definition.id
    )
      throw new Error("Reviewed query grant references an inconsistent query version");
    if (
      definition.projectId !== projectId ||
      connection.projectId !== projectId ||
      connection.secret.projectId !== projectId
    )
      throw new Error("Reviewed query grant crosses project boundaries");
    if (
      definition.environmentId !== environmentId ||
      connection.environmentId !== environmentId ||
      connection.secret.environmentId !== environmentId
    )
      throw new Error("Reviewed query grant crosses environment boundaries");
    if (!connection.enabled || !version.enabled)
      throw new Error(
        `Reviewed query ${definition.queryId}@${version.version} or its connection is disabled`,
      );
    if (connection.secretId !== connection.secret.id)
      throw new Error("Reviewed query connection secret reference is inconsistent");

    const parameterOrder = stringArray(version.parameterOrder);
    if (
      !Array.isArray(version.parameterOrder) ||
      parameterOrder.length !== version.parameterOrder.length ||
      new Set(parameterOrder).size !== parameterOrder.length
    )
      throw new Error(
        `Reviewed query ${definition.queryId} has an invalid parameter order`,
      );
    validateReviewedReadQuery(version.sql, parameterOrder);
    const parameterSchema = asRecord(version.parameterSchema);
    if (parameterSchema.type !== "object")
      throw new Error(
        `Reviewed query ${definition.queryId} parameter schema must have type object`,
      );
    validateReviewedParameterSchema(parameterOrder, parameterSchema);
    ajv.compile(parameterSchema);
    const resultSchema =
      version.resultSchema === null || version.resultSchema === undefined
        ? undefined
        : asRecord(version.resultSchema);
    if (resultSchema && !Object.keys(resultSchema).length)
      throw new Error(
        `Reviewed query ${definition.queryId} result schema must be an object`,
      );
    if (resultSchema) ajv.compile(resultSchema);
    if (
      !Number.isInteger(version.timeoutMs) ||
      version.timeoutMs < 100 ||
      version.timeoutMs > 30_000
    )
      throw new Error(
        `Reviewed query ${definition.queryId} timeout is outside allowed bounds`,
      );
    if (
      !Number.isInteger(version.maxRows) ||
      version.maxRows < 1 ||
      version.maxRows > 10_000
    )
      throw new Error(
        `Reviewed query ${definition.queryId} row limit is outside allowed bounds`,
      );
    if (
      !Number.isInteger(version.maxBytes) ||
      version.maxBytes < 1_024 ||
      version.maxBytes > 10_485_760
    )
      throw new Error(
        `Reviewed query ${definition.queryId} byte limit is outside allowed bounds`,
      );

    const uniqueness = `${grant.functionId}\u0000${definition.queryId}\u0000${connection.name}`;
    if (seen.has(uniqueness))
      throw new Error(
        `Function has duplicate reviewed query identity ${connection.name}/${definition.queryId}`,
      );
    seen.add(uniqueness);
    return {
      grantId: grant.id,
      functionId: grant.functionId,
      queryDefinitionId: definition.id,
      queryVersionId: version.id,
      queryId: definition.queryId,
      queryVersion: version.version,
      connection: {
        id: connection.id,
        name: connection.name,
        secretId: connection.secretId,
      },
      sql: version.sql,
      parameterOrder,
      parameterSchema,
      ...(resultSchema ? { resultSchema } : {}),
      timeoutMs: version.timeoutMs,
      maxRows: version.maxRows,
      maxBytes: version.maxBytes,
    };
  });
  return snapshot.sort(
    (left, right) =>
      left.functionId.localeCompare(right.functionId) ||
      left.connection.name.localeCompare(right.connection.name) ||
      left.queryId.localeCompare(right.queryId),
  );
}
