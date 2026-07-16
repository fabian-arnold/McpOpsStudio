import type { FastifyRequest } from "fastify";
import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { decryptSecret, assertAllowedUrl } from "@mcpops/sandbox";
import {
  entraPolicyConfigSchema,
  jwtPolicyConfigSchema,
  webhookSignaturePolicyConfigSchema,
} from "@mcpops/shared";
import { SafeRuntimeError, type CallerIdentity } from "@mcpops/runtime-sdk";
import type { AuthPolicy, LoadedEndpoint, EndpointAccessPolicy } from "./domain.js";
import {
  assertWebhookEndpoint,
  verifyWebhookRequest,
  type ReplayStore,
} from "./webhook-auth.js";
import { getEncryptedSecret } from "./repository.js";
import { verifyBasicAuthorization, verifyStaticCredential } from "./static-auth.js";
import { authenticateCustomFunction } from "./custom-auth.js";
import { assertAuthFeatureEnabled } from "./auth-features.js";

export {
  assertWebhookEndpoint,
  verifyWebhookRequest,
  type ReplayStore,
} from "./webhook-auth.js";
export { verifyBasicAuthorization, verifyStaticCredential } from "./static-auth.js";
export { runtimeAuthFeatureEnabled } from "./auth-features.js";

const remoteJwks = new Map<string, JWTVerifyGetKey>();
export type AuthenticationOptions = {
  endpoint: "mcp" | "http";
  rawBody?: Buffer;
  replayStore?: ReplayStore;
  now?: Date;
  invokeCustomFunction?: (functionId: string, input: unknown) => Promise<unknown>;
};

export async function authenticate(
  request: FastifyRequest,
  endpoint: LoadedEndpoint,
  policy: AuthPolicy | undefined,
  masterKey: Buffer,
  options: AuthenticationOptions,
): Promise<CallerIdentity> {
  const requestId = request.id;
  if (!policy)
    throw new SafeRuntimeError({
      code: "UNAUTHENTICATED",
      message: "This endpoint has no active authentication policy.",
      requestId,
    });
  if (policy.type === "public") {
    const permissions = Array.isArray(policy.config.permissions)
      ? policy.config.permissions.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    return {
      permissions,
      claims: {
        authentication: "public",
        authenticationPolicyId: policy.id,
      },
    };
  }
  if (policy.type === "api_key") {
    const header = String(policy.config.header ?? "x-api-key").toLowerCase();
    const supplied = request.headers[header];
    if (typeof supplied !== "string") deny(requestId);
    const expected = await policySecret(
      endpoint,
      String(policy.config.secretRef ?? ""),
      masterKey,
      requestId,
    );
    if (!verifyStaticCredential(supplied as string, expected)) deny(requestId);
    return identityFromPolicy(policy);
  }
  if (policy.type === "bearer_token") {
    const header = String(policy.config.header ?? "authorization").toLowerCase();
    const supplied = request.headers[header];
    const scheme = String(policy.config.scheme ?? "Bearer");
    if (typeof supplied !== "string" || !supplied.startsWith(`${scheme} `))
      deny(requestId);
    const expected = await policySecret(
      endpoint,
      String(policy.config.secretRef ?? ""),
      masterKey,
      requestId,
    );
    if (!verifyStaticCredential(supplied, `${scheme} ${expected}`)) deny(requestId);
    return identityFromPolicy(policy);
  }
  if (policy.type === "basic_auth") {
    const header = String(policy.config.header ?? "authorization").toLowerCase();
    const supplied = request.headers[header];
    const username = String(policy.config.username ?? "");
    if (typeof supplied !== "string" || !supplied.startsWith("Basic ") || !username)
      deny(requestId);
    const expectedPassword = await policySecret(
      endpoint,
      String(policy.config.secretRef ?? ""),
      masterKey,
      requestId,
    );
    if (!verifyBasicAuthorization(supplied, username, expectedPassword))
      deny(requestId);
    return identityFromPolicy(policy, `basic:${username}`);
  }
  if (policy.type === "jwt") {
    assertAuthFeatureEnabled("ENABLE_JWT_AUTH", "JWT", requestId);
    const parsed = jwtPolicyConfigSchema.safeParse(policy.config);
    if (!parsed.success)
      configuration("The JWT authentication policy is invalid.", requestId);
    const token = bearerToken(
      request,
      parsed.data.header,
      parsed.data.scheme,
      requestId,
    );
    const key = await remoteJwksKey(parsed.data.jwksUrl, requestId);
    return verifyJwtAccessToken(token, parsed.data, key, requestId);
  }
  if (policy.type === "entra_id") {
    assertAuthFeatureEnabled("ENABLE_ENTRA_AUTH", "Microsoft Entra", requestId);
    const parsed = entraPolicyConfigSchema.safeParse(policy.config);
    if (!parsed.success)
      configuration("The Microsoft Entra authentication policy is invalid.", requestId);
    const token = bearerToken(
      request,
      parsed.data.header,
      parsed.data.scheme,
      requestId,
    );
    const jwksUrl =
      parsed.data.jwksUrl ??
      `https://login.microsoftonline.com/${parsed.data.tenantId}/discovery/v2.0/keys`;
    assertMicrosoftJwksUrl(jwksUrl, requestId);
    const key = await remoteJwksKey(jwksUrl, requestId);
    return verifyEntraAccessToken(token, parsed.data, key, requestId);
  }
  if (policy.type === "webhook_signature") {
    assertWebhookEndpoint(options.endpoint, requestId);
    const parsed = webhookSignaturePolicyConfigSchema.safeParse(policy.config);
    if (!parsed.success)
      configuration("The webhook signature policy is invalid.", requestId);
    if (!options.rawBody || !options.replayStore)
      configuration(
        "Raw-body webhook verification is not available for this request.",
        requestId,
      );
    const secret = await policySecret(
      endpoint,
      parsed.data.secretRef,
      masterKey,
      requestId,
    );
    return verifyWebhookRequest({
      headers: request.headers,
      rawBody: options.rawBody,
      config: parsed.data,
      secret,
      policyId: policy.id,
      replayStore: options.replayStore,
      requestId,
      now: options.now ?? new Date(),
    });
  }
  if (policy.type === "custom_function")
    return authenticateCustomFunction(
      request,
      endpoint,
      policy,
      options.invokeCustomFunction,
    );
  throw new SafeRuntimeError({
    code: "CONFIGURATION_ERROR",
    message: `${policy.type} authentication is configured but not enabled in this deployment.`,
    requestId,
  });
}

export async function authenticateWithPolicies(
  request: FastifyRequest,
  endpoint: LoadedEndpoint,
  policies: readonly AuthPolicy[],
  masterKey: Buffer,
  options: AuthenticationOptions,
): Promise<CallerIdentity> {
  let lastAuthenticationError: SafeRuntimeError | undefined;
  for (const policy of policies) {
    try {
      return await authenticate(request, endpoint, policy, masterKey, options);
    } catch (error) {
      if (!(error instanceof SafeRuntimeError) || error.code !== "UNAUTHENTICATED")
        throw error;
      lastAuthenticationError = error;
    }
  }
  throw (
    lastAuthenticationError ??
    new SafeRuntimeError({
      code: "UNAUTHENTICATED",
      message: "This endpoint has no active authentication policy.",
      requestId: request.id,
    })
  );
}
export function identityFromPolicy(
  policy: AuthPolicy,
  subject = `policy:${policy.id}`,
): CallerIdentity {
  const permissions = Array.isArray(policy.config.permissions)
    ? policy.config.permissions.filter((v): v is string => typeof v === "string")
    : [];
  return {
    subject,
    permissions,
    claims: { authenticationPolicyId: policy.id },
  };
}
async function policySecret(
  endpoint: LoadedEndpoint,
  name: string,
  key: Buffer,
  requestId: string,
): Promise<string> {
  if (!name)
    throw new SafeRuntimeError({
      code: "CONFIGURATION_ERROR",
      message: "The endpoint credential is not configured.",
      requestId,
    });
  const encrypted = await getEncryptedSecret(endpoint, name);
  if (!encrypted)
    throw new SafeRuntimeError({
      code: "CONFIGURATION_ERROR",
      message: "The endpoint credential is not configured.",
      requestId,
    });
  try {
    return decryptSecret(encrypted, key);
  } catch {
    throw new SafeRuntimeError({
      code: "CONFIGURATION_ERROR",
      message: "The endpoint credential could not be loaded.",
      requestId,
    });
  }
}
type JwtConfig = ReturnType<typeof jwtPolicyConfigSchema.parse>;
type EntraConfig = ReturnType<typeof entraPolicyConfigSchema.parse>;
export async function verifyJwtAccessToken(
  token: string,
  config: JwtConfig,
  key: JWTVerifyGetKey,
  requestId: string,
): Promise<CallerIdentity> {
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: config.issuer,
      audience: config.audience,
      clockTolerance: config.clockSkewSeconds,
      algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
    });
    for (const [claim, allowed] of Object.entries(config.requiredClaims))
      if (!claimMatches(payload[claim], allowed)) unauthenticated(requestId);
    return callerFromPayload(payload);
  } catch (error) {
    if (error instanceof SafeRuntimeError) throw error;
    throw tokenError(error, requestId);
  }
}
export async function verifyEntraAccessToken(
  token: string,
  config: EntraConfig,
  key: JWTVerifyGetKey,
  requestId: string,
): Promise<CallerIdentity> {
  try {
    const { payload } = await jwtVerify(token, key, {
      audience: config.audience,
      clockTolerance: config.clockSkewSeconds,
      algorithms: ["RS256"],
    });
    const tenantId = normalizeTenantId(payload.tid, requestId);
    const issuer = String(payload.iss ?? "");
    const expectedIssuers = new Set([
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      `https://sts.windows.net/${tenantId}/`,
    ]);
    if (!expectedIssuers.has(issuer)) unauthenticated(requestId);
    if (
      config.tenantMode === "single_tenant" &&
      tenantId !== config.tenantId.toLowerCase()
    )
      unauthenticated(requestId);
    if (config.tenantMode === "multi_tenant") {
      if (
        /^[0-9a-f-]{36}$/i.test(config.tenantId) &&
        tenantId !== config.tenantId.toLowerCase()
      )
        unauthenticated(requestId);
      if (
        config.tenantId === "projects" &&
        tenantId === "9188040d-6c67-4c5b-b112-36a304b66dad"
      )
        unauthenticated(requestId);
      if (
        config.allowedTenantIds.length &&
        !config.allowedTenantIds.map((id) => id.toLowerCase()).includes(tenantId)
      )
        unauthenticated(requestId);
    }
    return { ...callerFromPayload(payload), tenantId };
  } catch (error) {
    if (error instanceof SafeRuntimeError) throw error;
    throw tokenError(error, requestId);
  }
}
export function authorizeEndpointAccess(
  caller: CallerIdentity,
  policy: EndpointAccessPolicy,
  requestId: string,
): void {
  const subjectDenied =
    policy.allowedSubjects.length > 0 &&
    (!caller.subject || !policy.allowedSubjects.includes(caller.subject));
  if (subjectDenied)
    throw new SafeRuntimeError({
      code: "FORBIDDEN",
      message: "The caller is not allowed to access this endpoint.",
      requestId,
    });
}
function deny(requestId: string): never {
  throw new SafeRuntimeError({
    code: "UNAUTHENTICATED",
    message: "Authentication is required.",
    requestId,
  });
}
function unauthenticated(requestId: string): never {
  throw new SafeRuntimeError({
    code: "UNAUTHENTICATED",
    message: "The supplied authentication credential is invalid or expired.",
    requestId,
  });
}
function configuration(message: string, requestId: string): never {
  throw new SafeRuntimeError({
    code: "CONFIGURATION_ERROR",
    message,
    requestId,
  });
}
function bearerToken(
  request: FastifyRequest,
  header: string,
  scheme: string,
  requestId: string,
): string {
  const value = request.headers[header.toLowerCase()];
  if (
    typeof value !== "string" ||
    !value.startsWith(`${scheme} `) ||
    value.length <= scheme.length + 1
  )
    unauthenticated(requestId);
  return value.slice(scheme.length + 1);
}
async function remoteJwksKey(
  rawUrl: string,
  requestId: string,
): Promise<JWTVerifyGetKey> {
  let url: URL;
  try {
    url = new URL(rawUrl);
    await assertAllowedUrl(
      url.toString(),
      {
        allowedHosts: [url.hostname],
        allowedMethods: ["GET"],
        allowedPorts: [443],
        maxResponseBytes: 1_048_576,
      },
      requestId,
    );
  } catch {
    configuration(
      "The authentication JWKS endpoint is not safely reachable.",
      requestId,
    );
  }
  const cacheKey = url.toString();
  let key = remoteJwks.get(cacheKey);
  if (!key) {
    key = createRemoteJWKSet(url, {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });
    remoteJwks.set(cacheKey, key);
  }
  return key;
}
function tokenError(error: unknown, requestId: string): SafeRuntimeError {
  if (error instanceof joseErrors.JWKSTimeout)
    return new SafeRuntimeError({
      code: "CONFIGURATION_ERROR",
      message: "The token verification endpoint is unavailable.",
      requestId,
      retryable: true,
    });
  if (error instanceof joseErrors.JOSEError)
    return new SafeRuntimeError({
      code: "UNAUTHENTICATED",
      message: "The supplied bearer token is invalid or expired.",
      requestId,
    });
  return new SafeRuntimeError({
    code: "CONFIGURATION_ERROR",
    message: "The token verification endpoint is unavailable.",
    requestId,
    retryable: true,
  });
}
function claimMatches(actual: unknown, allowed: readonly unknown[]): boolean {
  const actualValues = Array.isArray(actual) ? actual : [actual];
  return actualValues.some((value) => allowed.some((candidate) => candidate === value));
}
function claimStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];
}
function tokenScopes(payload: JWTPayload): string[] {
  return [
    ...new Set(
      [
        ...claimStrings(payload.scope).flatMap((value) => value.split(/\s+/)),
        ...claimStrings(payload.scp).flatMap((value) => value.split(/\s+/)),
      ].filter(Boolean),
    ),
  ];
}
function callerFromPayload(payload: JWTPayload): CallerIdentity {
  return {
    ...(typeof payload.sub === "string" ? { subject: payload.sub } : {}),
    ...(typeof payload.email === "string" ? { email: payload.email } : {}),
    ...(typeof payload.name === "string" ? { name: payload.name } : {}),
    ...(typeof payload.tid === "string" ? { tenantId: payload.tid.toLowerCase() } : {}),
    permissions: tokenScopes(payload),
    claims: { ...payload },
  };
}
function normalizeTenantId(value: unknown, requestId: string): string {
  const tenantId = typeof value === "string" ? value.toLowerCase() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      tenantId,
    )
  )
    unauthenticated(requestId);
  return tenantId;
}
function assertMicrosoftJwksUrl(rawUrl: string, requestId: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    configuration("The Microsoft Entra JWKS URL is invalid.", requestId);
  }
  if (url.protocol !== "https:" || url.hostname !== "login.microsoftonline.com")
    configuration(
      "Microsoft Entra JWKS must use login.microsoftonline.com.",
      requestId,
    );
}
