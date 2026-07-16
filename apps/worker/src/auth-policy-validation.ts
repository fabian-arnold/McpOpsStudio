import { asRecord } from "./builder-validation.js";

type AuthPolicyRow = {
  id: string;
  projectId: string;
  name: string;
  type: string;
  config: unknown;
};

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
  if (type === "custom_function") {
    requiredString(config, "functionId");
    if (!isUuid(String(config.functionId)))
      throw new Error("Custom authentication functionId must be a UUID");
    return;
  }
  throw new Error(`Unsupported authentication policy type: ${type}`);
}
export function referencedAuthFunctionIds(
  policies: ReadonlyArray<{ type: string; config: unknown }>,
): string[] {
  return [
    ...new Set(
      policies.flatMap((policy) => {
        if (policy.type !== "custom_function") return [];
        const functionId = asRecord(policy.config).functionId;
        return typeof functionId === "string" ? [functionId] : [];
      }),
    ),
  ];
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
export function referencedAuthSecretNames(
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
