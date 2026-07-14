import { prisma } from "@mcpops/db";
import {
  functionTemplates,
  networkPolicyUpdateSchema,
  parseManifest,
  type EndpointManifest,
} from "@mcpops/shared";
import { platformCapabilities } from "./capabilities.js";
import {
  canonicalEndpointUrls,
  canonicalEnvironmentEndpointUrls,
} from "./analytics.js";
import { buildManifestPlan } from "./manifest-plan.js";
import { providerStatus } from "./control-plane-validation.js";
import { type projectRepository } from "./repository.js";
import { networkPolicyView } from "./api-operation-helpers.js";
import { record, stringList } from "./api-value-helpers.js";

export async function loadTemplateInstallContext(
  projectId: string,
  endpointId: string,
  templateId: string,
) {
  const template = functionTemplates.find((candidate) => candidate.id === templateId);
  if (!template) return null;
  const endpoint = await prisma.runtimeEndpoint.findFirst({
    where: { id: endpointId, projectId },
    include: { networkPolicy: true },
  });
  if (!endpoint) return null;
  const [secrets, authPolicies] = await Promise.all([
    prisma.secret.findMany({
      where: { projectId, environmentId: endpoint.environmentId },
      select: { id: true, name: true },
    }),
    prisma.authPolicy.findMany({
      where: { projectId },
      select: { id: true, type: true },
    }),
  ]);
  const platform = platformCapabilities();
  const capabilities = ["webhook_signature_auth"];
  if (endpoint.networkPolicy) capabilities.push("network_policy");
  if (platform.runtimeCapabilities.reviewedDatabaseQueries)
    capabilities.push("reviewed_database_queries");
  return {
    template,
    endpoint,
    context: {
      allowedHosts: stringList(endpoint.networkPolicy?.allowedHosts),
      secrets,
      authPolicies: authPolicies.map((policy) => ({
        id: policy.id,
        type: String(policy.type),
      })),
      capabilities,
    },
  };
}

type EndpointViewRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  kind: "mcp" | "http";
  status: string;
  createdAt: Date;
  updatedAt: Date;
  project: {
    slug: string;
    environments: Array<{ slug: string; baseUrl: string }>;
  };
  environment: { id: string; name: string; slug: string; baseUrl: string };
  activeDeployment: {
    id: string;
    version: number;
    createdAt: Date;
    checksum: string;
  } | null;
  defaultAuthPolicy?: { type: string } | null;
  authPolicyAssignments?: Array<{ authPolicy: { type: string } }>;
  _count: {
    mcpToolBindings: number;
    httpRouteBindings: number;
  };
  mcpToolBindings?: Array<{ functionId: string }>;
  httpRouteBindings?: Array<{ functionId: string }>;
};
export function endpointView<T extends EndpointViewRow>(endpoint: T) {
  return {
    ...endpoint,
    endpoints: canonicalEndpointUrls(
      endpoint.environment.baseUrl,
      endpoint.project.slug,
      endpoint.slug,
      endpoint.environment.slug === "development" ? "-dev" : "",
    ),
    environmentEndpoints: canonicalEnvironmentEndpointUrls(
      endpoint.project.environments,
      endpoint.project.slug,
      endpoint.slug,
    ),
    activeDeployment: endpoint.activeDeployment ?? undefined,
    functionCount: new Set([
      ...(endpoint.mcpToolBindings ?? []).map((binding) => binding.functionId),
      ...(endpoint.httpRouteBindings ?? []).map((binding) => binding.functionId),
    ]).size,
    mcpToolCount: endpoint._count.mcpToolBindings,
    httpRouteCount: endpoint._count.httpRouteBindings,
    authMode:
      endpoint.authPolicyAssignments?.map((item) => item.authPolicy.type).join(" → ") ||
      endpoint.defaultAuthPolicy?.type ||
      "none",
  };
}
type LoadedControlEndpoint = NonNullable<
  Awaited<ReturnType<ReturnType<typeof projectRepository>["endpoint"]>>
>;

export function numericSetting(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function endpointSettingsView(endpoint: {
  name: string;
  slug: string;
  description: string;
  runtimeVersion: string;
  runtimeConfig: unknown;
}) {
  const config = record(endpoint.runtimeConfig);
  const rawEnvironment = record(config.env);
  const env = Object.fromEntries(
    Object.entries(rawEnvironment).filter(
      ([name, value]) =>
        typeof value === "string" &&
        !/(?:^|_)(?:SECRET|TOKEN|PASSWORD|API_KEY)(?:_|$)/.test(name),
    ),
  );
  return {
    name: endpoint.name,
    slug: endpoint.slug,
    description: endpoint.description,
    runtimeVersion: endpoint.runtimeVersion,
    runtime: {
      timeoutMs: numericSetting(config.timeoutMs, 30_000),
      maxConcurrentRequests: numericSetting(config.maxConcurrentRequests, 20),
    },
    env,
    omittedSensitiveEnvironmentVariableCount:
      Object.keys(rawEnvironment).length - Object.keys(env).length,
    endpointAccessPolicy: {
      mode:
        record(config.endpointAccessPolicy).mode === "restricted"
          ? "restricted"
          : "authenticated",
      allowedSubjects: stringList(record(config.endpointAccessPolicy).allowedSubjects),
    },
  };
}

export function currentEndpointManifest(
  endpoint: LoadedControlEndpoint,
): EndpointManifest {
  const settings = endpointSettingsView(endpoint);
  const network = networkPolicyView(endpoint.networkPolicy);
  const functionName = new Map(endpoint.functions.map((fn) => [fn.id, fn.name]));
  return parseManifest(
    JSON.stringify({
      endpoint: {
        kind: endpoint.kind,
        name: endpoint.name,
        slug: endpoint.slug,
        description: endpoint.description,
        runtimeVersion: endpoint.runtimeVersion,
        runtime: {
          ...settings.runtime,
          env: settings.env,
          endpointAccessPolicy: settings.endpointAccessPolicy,
        },
        network: network.nextSnapshotPolicy,
      },
      ...(endpoint.defaultAuthPolicy
        ? { auth: { policy: endpoint.defaultAuthPolicy.name } }
        : {}),
      functions: endpoint.functions.map((fn) => ({
        name: fn.name,
        enabled: fn.enabled,
        riskLevel: fn.riskLevel,
        requiredPermissions: fn.requiredPermissions as string[],
      })),
      ...(endpoint.kind === "mcp"
        ? {
            mcp: {
              tools: endpoint.mcpToolBindings.map((binding) => ({
                toolName: binding.toolName,
                function: functionName.get(binding.functionId) ?? binding.functionId,
                title: binding.title,
                description: binding.description,
                enabled: binding.enabled,
              })),
            },
          }
        : {}),
      ...(endpoint.kind === "http"
        ? {
            http: {
              routes: endpoint.httpRouteBindings.map((binding) => ({
                method: binding.method,
                path: binding.path,
                function: functionName.get(binding.functionId) ?? binding.functionId,
                inputMapping: binding.inputMapping,
                responseMapping: binding.responseMapping,
                enabled: binding.enabled,
              })),
            },
          }
        : {}),
    }),
    "json",
  );
}

export async function createManifestPlan(
  projectId: string,
  endpoint: LoadedControlEndpoint,
  manifest: EndpointManifest,
) {
  const policies = await prisma.authPolicy.findMany({
    where: { projectId },
    select: { id: true, name: true, type: true, config: true },
  });
  const plan = buildManifestPlan(
    {
      endpoint: {
        name: endpoint.name,
        slug: endpoint.slug,
        description: endpoint.description,
        kind: endpoint.kind,
      },
      functions: endpoint.functions,
      mcpBindings: endpoint.mcpToolBindings,
      httpBindings: endpoint.httpRouteBindings,
      authPolicies: policies,
    },
    manifest,
  );
  const networkValidation = networkPolicyUpdateSchema.safeParse(
    manifest.endpoint.network,
  );
  if (!networkValidation.success)
    plan.errors.push({
      code: "INVALID_NETWORK_POLICY",
      target: "endpoint.network",
      message: networkValidation.error.issues.map((issue) => issue.message).join("; "),
    });
  const slugCollision = await prisma.runtimeEndpoint.findFirst({
    where: {
      projectId,
      environmentId: endpoint.environmentId,
      slug: manifest.endpoint.slug,
      id: { not: endpoint.id },
    },
    select: { id: true },
  });
  if (slugCollision)
    plan.errors.push({
      code: "SERVICE_SLUG_CONFLICT",
      target: manifest.endpoint.slug,
      message: "Another endpoint in this environment already uses this slug.",
    });
  const referencedPolicyNames = new Set([
    ...(manifest.auth ? [manifest.auth.policy] : []),
  ]);
  const environmentSecrets = new Set(
    (
      await prisma.secret.findMany({
        where: { projectId, environmentId: endpoint.environmentId },
        select: { name: true },
      })
    ).map((secret) => secret.name),
  );
  for (const policy of policies.filter((candidate) =>
    referencedPolicyNames.has(candidate.name),
  )) {
    const secretRef = record(policy.config).secretRef;
    if (typeof secretRef === "string" && !environmentSecrets.has(secretRef))
      plan.errors.push({
        code: "AUTH_POLICY_SECRET_NOT_FOUND",
        target: policy.name,
        message: `Policy secretRef '${secretRef}' is not configured in the endpoint environment.`,
      });
  }
  for (const policy of policies.filter(
    (candidate) =>
      referencedPolicyNames.has(candidate.name) &&
      providerStatus(candidate.type) !== "enabled",
  ))
    plan.errors.push({
      code: "AUTH_PROVIDER_DEFERRED",
      target: policy.name,
      message: `Authentication provider '${policy.type}' is not enabled in this deployment.`,
    });
  plan.valid = plan.errors.length === 0;
  return plan;
}
