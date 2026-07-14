import { createHash } from "node:crypto";
import { Ajv } from "ajv";
import { bundleFunction as bundleRestrictedFunction } from "@mcpops/sandbox";
import {
  canonicalJson,
  resolveFunctionCallGraph,
  validateReviewedParameterSchema,
  validateReviewedReadQuery,
  type DeploymentSnapshot,
  type SnapshotReviewedQuery,
} from "@mcpops/shared";
import { prisma } from "@mcpops/db";
import { finalizeProjectDeployment } from "./project-deployment.js";

type ExtendedDeploymentSnapshot = DeploymentSnapshot & {
  endpointAccessPolicy: {
    mode: "authenticated" | "restricted";
    allowedSubjects: string[];
  };
  networkPolicy?: NonNullable<DeploymentSnapshot["networkPolicy"]> & {
    allowPrivateHosts: string[];
  };
};
type AuthPolicyRow = {
  id: string;
  projectId: string;
  name: string;
  type: string;
  config: unknown;
};

export type BuildInput = {
  code: string;
  inputSchema: unknown;
  outputSchema: unknown;
  libraries: Array<{ importPath: string; code: string }>;
  sourcefile?: string;
};
export async function bundleFunction(
  input: BuildInput,
): Promise<{ code: string; sourceMap?: string; warnings: string[] }> {
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.compile(input.inputSchema as object);
  ajv.compile(input.outputSchema as object);
  const result = await bundleRestrictedFunction({
    code: input.code,
    sourcefile: input.sourcefile,
    projectLibraries: input.libraries.map((library) => ({
      ...library,
      version: 0,
    })),
  });
  return {
    code: result.compiledCode,
    ...(result.sourceMap ? { sourceMap: result.sourceMap } : {}),
    warnings: [],
  };
}

export async function buildDeployment(
  deploymentId: string,
  actorId?: string,
): Promise<void> {
  const deployment = await prisma.deployment.findUniqueOrThrow({
    where: { id: deploymentId },
    include: {
      endpoint: {
        include: {
          project: true,
          environment: true,
          mcpToolBindings: true,
          httpRouteBindings: true,
          defaultAuthPolicy: true,
          authPolicyAssignments: {
            include: { authPolicy: true },
            orderBy: { position: "asc" },
          },
          networkPolicy: true,
        },
      },
    },
  });
  const endpoint = deployment.endpoint;
  let activated = false;
  let failureFunctions: Array<{
    id: string;
    name: string;
    slug: string;
    version: number;
  }> = [];
  try {
    if (deployment.projectDeploymentId)
      await prisma.projectDeployment.updateMany({
        where: { id: deployment.projectDeploymentId, status: "queued" },
        data: { status: "building" },
      });
    if (
      (endpoint.kind === "mcp" && endpoint.httpRouteBindings.length > 0) ||
      (endpoint.kind === "http" && endpoint.mcpToolBindings.length > 0)
    )
      throw new Error("Runtime endpoint contains bindings for the wrong protocol");
    const projectFunctions = await prisma.function.findMany({
      where: { projectId: endpoint.projectId, enabled: true },
      include: {
        versions: { orderBy: { version: "desc" }, take: 1 },
        grants: true,
      },
    });
    const entryFunctionIds = new Set([
      ...(endpoint.kind === "mcp" ? endpoint.mcpToolBindings : [])
        .filter((binding) => binding.enabled)
        .map((binding) => binding.functionId),
      ...(endpoint.kind === "http" ? endpoint.httpRouteBindings : [])
        .filter((binding) => binding.enabled)
        .map((binding) => binding.functionId),
    ]);
    const { functions: selectedFunctions, calls: functionCalls } =
      resolveFunctionCallGraph(projectFunctions, entryFunctionIds);
    const requiredFunctionSecrets = [
      ...new Set(
        selectedFunctions.flatMap((fn) => fn.grants.map((grant) => grant.secretName)),
      ),
    ];
    if (requiredFunctionSecrets.length) {
      const configured = await prisma.secret.findMany({
        where: {
          projectId: endpoint.projectId,
          environmentId: endpoint.environmentId,
          name: { in: requiredFunctionSecrets },
        },
        select: { name: true },
      });
      const available = new Set(configured.map((secret) => secret.name));
      const missing = requiredFunctionSecrets.filter((name) => !available.has(name));
      if (missing.length) {
        failureFunctions = selectedFunctions
          .filter((fn) => fn.grants.some((grant) => missing.includes(grant.secretName)))
          .map((fn) => ({
            id: fn.id,
            name: fn.name,
            slug: fn.slug,
            version: fn.versions[0]?.version ?? 0,
          }));
        throw new Error(
          `Required function secrets are not configured in ${endpoint.environment.name}: ${missing.join(", ")}`,
        );
      }
    }
    failureFunctions = [];
    const libraries = await prisma.projectLibrary.findMany({
      where: { projectId: endpoint.projectId },
    });
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: "building" },
    });
    await prisma.deploymentLog.create({
      data: {
        deploymentId,
        level: "info",
        message: `Building ${selectedFunctions.length} reusable functions`,
      },
    });
    const requiredPolicyIds = collectRequiredAuthPolicyIds(
      endpoint.authPolicyAssignments.map((item) => item.authPolicyId),
      endpoint.mcpToolBindings,
      endpoint.httpRouteBindings,
    );
    const policyRows = requiredPolicyIds.length
      ? await prisma.authPolicy.findMany({
          where: {
            id: { in: requiredPolicyIds },
            projectId: endpoint.projectId,
          },
        })
      : [];
    const authPolicies = snapshotReferencedAuthPolicies(
      endpoint.projectId,
      requiredPolicyIds,
      policyRows,
    );
    const authSecretNames = referencedAuthSecretNames(authPolicies);
    const availableAuthSecrets = authSecretNames.length
      ? await prisma.secret.findMany({
          where: {
            projectId: endpoint.projectId,
            environmentId: endpoint.environmentId,
            name: { in: authSecretNames },
          },
          select: { name: true },
        })
      : [];
    validateAuthSecretReferences(
      authSecretNames,
      availableAuthSecrets.map((secret) => secret.name),
    );
    const reviewedQueryFeatureEnabled =
      process.env.ENABLE_REVIEWED_DB_QUERIES === "true";
    const reviewedQueryRows = await prisma.functionQueryGrant.findMany({
      where: {
        enabled: true,
        functionId: { in: selectedFunctions.map((fn) => fn.id) },
      },
      select: {
        id: true,
        functionId: true,
        queryDefinitionId: true,
        queryVersionId: true,
        queryDefinition: {
          select: {
            id: true,
            projectId: true,
            environmentId: true,
            queryId: true,
            connection: {
              select: {
                id: true,
                projectId: true,
                environmentId: true,
                secretId: true,
                name: true,
                enabled: true,
                secret: {
                  select: { id: true, projectId: true, environmentId: true },
                },
              },
            },
          },
        },
        queryVersion: {
          select: {
            id: true,
            queryDefinitionId: true,
            version: true,
            sql: true,
            parameterOrder: true,
            parameterSchema: true,
            resultSchema: true,
            timeoutMs: true,
            maxRows: true,
            maxBytes: true,
            enabled: true,
          },
        },
      },
    });
    if (reviewedQueryRows.length && !reviewedQueryFeatureEnabled) {
      const affectedIds = new Set(reviewedQueryRows.map((row) => row.functionId));
      failureFunctions = selectedFunctions
        .filter((fn) => affectedIds.has(fn.id))
        .map((fn) => ({
          id: fn.id,
          name: fn.name,
          slug: fn.slug,
          version: fn.versions[0]?.version ?? 0,
        }));
      throw new Error(
        "Reviewed database query grants require ENABLE_REVIEWED_DB_QUERIES=true",
      );
    }
    failureFunctions = [];
    const reviewedQueries = reviewedQueryFeatureEnabled
      ? snapshotReviewedQueries(
          endpoint.projectId,
          endpoint.environmentId,
          reviewedQueryRows,
        )
      : [];
    const functions = [];
    for (const fn of selectedFunctions) {
      const version = fn.versions[0];
      if (!version) throw new Error(`Function ${fn.name} has no source version`);
      failureFunctions = [
        {
          id: fn.id,
          name: fn.name,
          slug: fn.slug,
          version: version.version,
        },
      ];
      const result = await bundleFunction({
        code: version.code,
        inputSchema: fn.inputSchema,
        outputSchema: fn.outputSchema,
        sourcefile: `${fn.slug}.ts`,
        libraries: libraries.map((library) => ({
          importPath: library.importPath,
          code: library.code,
        })),
      });
      await prisma.functionVersion.update({
        where: { id: version.id },
        data: {
          compiledCode: result.code,
          sourceMap: result.sourceMap ?? null,
          validationResult: {
            valid: true,
            warnings: result.warnings,
            builtAt: new Date().toISOString(),
          },
        },
      });
      functions.push({
        id: fn.id,
        functionId: fn.id,
        versionId: version.id,
        version: version.version,
        name: fn.name,
        slug: fn.slug,
        description: fn.description,
        code: version.code,
        compiledCode: result.code,
        checksum: version.checksum,
        inputSchema: fn.inputSchema as Record<string, unknown>,
        outputSchema: fn.outputSchema as Record<string, unknown>,
        timeoutMs: fn.timeoutMs,
        riskLevel: fn.riskLevel,
        enabled: fn.enabled,
        requiredPermissions: fn.requiredPermissions as string[],
        secretGrants: fn.grants.map((grant) => grant.secretName),
        secretRefs: fn.grants.map((grant) => ({
          id: grant.secretId ?? `name:${grant.secretName}`,
          name: grant.secretName,
        })),
        cachePolicy: validateCachePolicy(fn.cachePolicy),
      });
      await prisma.deploymentLog.create({
        data: {
          deploymentId,
          level: "info",
          message: `Validated and bundled ${fn.name}@${version.version}`,
          metadata: { checksum: version.checksum, warnings: result.warnings },
        },
      });
      failureFunctions = [];
    }
    const runtimeConfig = asRecord(deployment.runtimeConfig);
    const env = validateRuntimeEnvironment(runtimeConfig.env);
    const endpointAccessPolicy = validateEndpointAccessPolicy(
      runtimeConfig.endpointAccessPolicy,
    );
    const configuredPrivateHosts = endpoint.networkPolicy
      ? (endpoint.networkPolicy.allowPrivateHosts as string[])
      : [];
    const snapshot: ExtendedDeploymentSnapshot = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      project: {
        id: endpoint.project.id,
        slug: endpoint.project.slug,
        name: endpoint.project.name,
      },
      environment: {
        id: endpoint.environment.id,
        slug: endpoint.environment.slug,
        name: endpoint.environment.name,
      },
      endpoint: {
        id: endpoint.id,
        slug: endpoint.slug,
        name: endpoint.name,
        kind: endpoint.kind,
      },
      functions,
      functionCalls,
      mcpBindings: (endpoint.kind === "mcp" ? endpoint.mcpToolBindings : [])
        .filter((binding) => binding.enabled)
        .map((binding) => ({
          id: binding.id,
          functionId: binding.functionId,
          toolName: binding.toolName,
          title: binding.title,
          description: binding.description,
          enabled: binding.enabled,
        })),
      httpBindings: (endpoint.kind === "http" ? endpoint.httpRouteBindings : [])
        .filter((binding) => binding.enabled)
        .map((binding) => ({
          id: binding.id,
          functionId: binding.functionId,
          method: binding.method,
          path: binding.path,
          inputMapping: binding.inputMapping,
          responseMapping: validateResponseMappingDefinition(binding.responseMapping),
          enabled: binding.enabled,
        })),
      libraries: libraries.map((library) => ({
        id: library.id,
        name: library.name,
        importPath: library.importPath,
        version: library.version,
        code: library.code,
      })),
      authPolicies,
      ...(requiredPolicyIds[0] ? { defaultAuthPolicyId: requiredPolicyIds[0] } : {}),
      capabilities: {
        reviewedDatabaseQueries: { enabled: reviewedQueryFeatureEnabled },
      },
      reviewedQueries,
      endpointAccessPolicy,
      env,
      ...(endpoint.networkPolicy
        ? {
            networkPolicy: {
              allowedHosts: endpoint.networkPolicy.allowedHosts as string[],
              allowedMethods: endpoint.networkPolicy.allowedMethods as string[],
              allowedPorts: endpoint.networkPolicy.allowedPorts as number[],
              maxResponseBytes: endpoint.networkPolicy.maxResponseBytes,
              allowPrivateHosts: validatePrivateHosts(
                configuredPrivateHosts,
                endpoint.networkPolicy.allowedHosts as string[],
              ),
            },
          }
        : {}),
    };
    const sum = createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
    await prisma.$transaction(async (tx) => {
      if (deployment.projectDeploymentId) {
        await tx.deployment.update({
          where: { id: deploymentId },
          data: {
            snapshot: snapshot as never,
            checksum: sum,
            status: "deploying",
          },
        });
        await tx.deploymentLog.create({
          data: {
            deploymentId,
            level: "info",
            message: `Endpoint artifact ${deployment.version} built for project deployment`,
            metadata: { checksum: sum },
          },
        });
        return;
      }
      if (endpoint.activeDeploymentId)
        await tx.deployment.update({
          where: { id: endpoint.activeDeploymentId },
          data: { status: "rolled_back" },
        });
      await tx.deployment.update({
        where: { id: deploymentId },
        data: {
          snapshot: snapshot as never,
          checksum: sum,
          status: "active",
          completedAt: new Date(),
        },
      });
      await tx.runtimeEndpoint.update({
        where: { id: endpoint.id },
        data: { activeDeploymentId: deploymentId, status: "deployed" },
      });
      await tx.deploymentLog.create({
        data: {
          deploymentId,
          level: "info",
          message: `Deployment ${deployment.version} activated`,
          metadata: { checksum: sum },
        },
      });
      await tx.auditEvent.create({
        data: {
          projectId: endpoint.projectId,
          environmentId: endpoint.environmentId,
          endpointId: endpoint.id,
          actorType: actorId ? "user" : "system",
          actorId,
          action: "deployment.activated",
          targetType: "deployment",
          targetId: deploymentId,
          metadata: { version: deployment.version, checksum: sum },
        },
      });
    });
    activated = true;
    if (deployment.projectDeploymentId)
      await finalizeProjectDeployment(deployment.projectDeploymentId);
  } catch (error) {
    if (activated) throw error;
    const message = error instanceof Error ? error.message : "Build failed";
    const failureOperations = [
      prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: "failed", completedAt: new Date() },
      }),
      prisma.deploymentLog.create({
        data: {
          deploymentId,
          level: "error",
          message,
          metadata: failureFunctions.length
            ? {
                functions: failureFunctions.map((fn) => ({
                  functionId: fn.id,
                  functionName: fn.name,
                  functionSlug: fn.slug,
                  functionVersion: fn.version,
                })),
              }
            : undefined,
        },
      }),
      ...(deployment.projectDeploymentId
        ? []
        : [
            prisma.runtimeEndpoint.update({
              where: { id: endpoint.id },
              data: { status: "failed" },
            }),
          ]),
    ];
    await prisma.$transaction(failureOperations);
    if (deployment.projectDeploymentId)
      await finalizeProjectDeployment(deployment.projectDeploymentId);
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
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
function validateEndpointAccessPolicy(
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
function validatePrivateHosts(hosts: string[], allowedHosts: string[]): string[] {
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

export function collectRequiredAuthPolicyIds(
  assignedPolicyIds: readonly string[],
  mcpBindings: Array<{ enabled: boolean }>,
  httpBindings: Array<{ enabled: boolean }>,
): string[] {
  const enabledMcp = mcpBindings.some((binding) => binding.enabled);
  const enabledRoutes = httpBindings.some((binding) => binding.enabled);
  const needsDefault = enabledMcp || enabledRoutes;
  if (needsDefault && !assignedPolicyIds.length)
    throw new Error(
      "An enabled MCP binding or HTTP route requires an authentication policy",
    );
  return [...new Set(assignedPolicyIds)];
}
export function snapshotReferencedAuthPolicies(
  projectId: string,
  requiredIds: readonly string[],
  policies: readonly AuthPolicyRow[],
): Array<{ id: string; name: string; type: string; config: unknown }> {
  const byId = new Map(
    policies
      .filter((policy) => policy.projectId === projectId)
      .map((policy) => [policy.id, policy]),
  );
  const missing = requiredIds.filter((id) => !byId.has(id));
  if (missing.length)
    throw new Error(
      `Referenced authentication policies are missing or outside the endpoint project: ${missing.join(", ")}`,
    );
  return requiredIds.map((id) => {
    const policy = byId.get(id) as AuthPolicyRow;
    validateAuthPolicyConfig(policy.type, policy.config);
    return {
      id: policy.id,
      name: policy.name,
      type: policy.type,
      config: structuredClone(policy.config),
    };
  });
}
export function validateAuthPolicyConfig(type: string, value: unknown): void {
  const config = asRecord(value);
  if (type === "public") {
    requiredStringArray(config, "permissions");
    return;
  }
  if (type === "api_key" || type === "bearer_token" || type === "basic_auth") {
    requiredString(config, "header");
    requiredString(config, "secretRef");
    requiredStringArray(config, "permissions");
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(String(config.header)))
      throw new Error(`${type} authentication header is invalid`);
    if (!/^[A-Z][A-Z0-9_]{1,99}$/.test(String(config.secretRef)))
      throw new Error(`${type} secretRef is invalid`);
    if (type === "bearer_token") {
      requiredString(config, "scheme");
      if (config.scheme !== "Bearer")
        throw new Error("bearer_token scheme must be Bearer");
    }
    if (type === "basic_auth") {
      requiredString(config, "username");
      requiredString(config, "scheme");
      if (config.header !== "authorization" || config.scheme !== "Basic")
        throw new Error("basic_auth must use the Authorization: Basic scheme");
    }
    return;
  }
  if (type === "jwt") {
    requiredString(config, "header");
    requiredString(config, "scheme");
    validateBearerHeader(config);
    requiredUrl(config, "issuer");
    requiredUrl(config, "jwksUrl");
    if (
      typeof config.audience !== "string" &&
      (!Array.isArray(config.audience) ||
        !config.audience.length ||
        !config.audience.every((item) => typeof item === "string"))
    )
      throw new Error("jwt audience must be a string or string array");
    const claims = asRecord(config.requiredClaims);
    for (const [name, allowed] of Object.entries(claims))
      if (
        !name ||
        !Array.isArray(allowed) ||
        !allowed.length ||
        !allowed.every((item) => ["string", "number", "boolean"].includes(typeof item))
      )
        throw new Error("jwt requiredClaims entries must be non-empty scalar arrays");
    validateClockSkew(config.clockSkewSeconds);
    return;
  }
  if (type === "entra_id") {
    requiredString(config, "header");
    requiredString(config, "scheme");
    validateBearerHeader(config);
    requiredString(config, "tenantMode");
    requiredString(config, "tenantId");
    requiredString(config, "audience");
    requiredStringArray(config, "allowedTenantIds");
    validateClockSkew(config.clockSkewSeconds);
    if (!new Set(["single_tenant", "multi_tenant"]).has(String(config.tenantMode)))
      throw new Error("entra_id tenantMode is invalid");
    const tenant = String(config.tenantId);
    if (config.tenantMode === "single_tenant" && !isUuid(tenant))
      throw new Error("Single-tenant Entra policies require a tenant UUID");
    if (
      config.tenantMode === "multi_tenant" &&
      !["common", "projects"].includes(tenant) &&
      !isUuid(tenant)
    )
      throw new Error("Multi-tenant Entra tenantId is invalid");
    if (config.jwksUrl !== undefined) {
      requiredUrl(config, "jwksUrl");
      if (new URL(String(config.jwksUrl)).hostname !== "login.microsoftonline.com")
        throw new Error("Entra JWKS must use login.microsoftonline.com");
    }
    return;
  }
  if (type === "oidc") {
    requiredUrl(config, "issuer");
    requiredString(config, "audience");
    return;
  }
  if (type === "webhook_signature") {
    requiredString(config, "header");
    requiredString(config, "timestampHeader");
    requiredString(config, "secretRef");
    requiredStringArray(config, "permissions");
    if (
      !/^[a-z0-9-]{1,64}$/.test(String(config.header)) ||
      !/^[a-z0-9-]{1,64}$/.test(String(config.timestampHeader))
    )
      throw new Error("Webhook signature header names are invalid");
    if (!/^[A-Z][A-Z0-9_]{1,99}$/.test(String(config.secretRef)))
      throw new Error("Webhook signature secretRef is invalid");
    if (
      config.algorithm !== "hmac-sha256" ||
      config.signaturePrefix !== "sha256=" ||
      config.replayProtection !== true
    )
      throw new Error(
        "Webhook signature policies require hmac-sha256, sha256= prefix, and replay protection",
      );
    if (
      !Number.isInteger(config.toleranceSeconds) ||
      Number(config.toleranceSeconds) < 30 ||
      Number(config.toleranceSeconds) > 900
    )
      throw new Error("Webhook timestamp tolerance must be 30 through 900 seconds");
    return;
  }
  throw new Error(`Unsupported authentication policy type: ${type}`);
}
function requiredString(config: Record<string, unknown>, name: string): void {
  if (typeof config[name] !== "string" || !String(config[name]).trim())
    throw new Error(`Authentication policy requires ${name}`);
}
function requiredStringArray(config: Record<string, unknown>, name: string): void {
  if (
    !Array.isArray(config[name]) ||
    !(config[name] as unknown[]).every((item) => typeof item === "string")
  )
    throw new Error(`Static authentication policy requires explicit ${name}: string[]`);
}
function requiredUrl(config: Record<string, unknown>, name: string): void {
  requiredString(config, name);
  try {
    const url = new URL(String(config[name]));
    if (url.protocol !== "https:") throw new Error();
  } catch {
    throw new Error(`Authentication policy ${name} must be an HTTPS URL`);
  }
}
function validateClockSkew(value: unknown): void {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 300)
    throw new Error("Token clockSkewSeconds must be 0 through 300");
}
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
function validateBearerHeader(config: Record<string, unknown>): void {
  if (config.header !== "authorization" || config.scheme !== "Bearer")
    throw new Error("Token policies require the Authorization: Bearer scheme");
}
function referencedAuthSecretNames(
  policies: ReadonlyArray<{ type: string; config: unknown }>,
): string[] {
  return [
    ...new Set(
      policies.flatMap((policy) => {
        if (
          !new Set(["api_key", "bearer_token", "basic_auth", "webhook_signature"]).has(
            policy.type,
          )
        )
          return [];
        const value = asRecord(policy.config).secretRef;
        return typeof value === "string" ? [value] : [];
      }),
    ),
  ].sort();
}
export function validateAuthSecretReferences(
  required: readonly string[],
  available: readonly string[],
): void {
  const existing = new Set(available);
  const missing = required.filter((name) => !existing.has(name));
  if (missing.length)
    throw new Error(
      `Authentication policy secrets are missing from the endpoint environment: ${missing.join(", ")}`,
    );
}
