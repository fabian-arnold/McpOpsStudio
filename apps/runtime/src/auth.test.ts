import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import {
  entraPolicyConfigSchema,
  jwtPolicyConfigSchema,
  webhookSignaturePolicyConfigSchema,
} from "@mcpops/shared";
import {
  authenticateWithPolicies,
  assertWebhookEndpoint,
  authorizeEndpointAccess,
  identityFromPolicy,
  runtimeAuthFeatureEnabled,
  verifyBasicAuthorization,
  verifyEntraAccessToken,
  verifyJwtAccessToken,
  verifyStaticCredential,
  verifyWebhookRequest,
} from "./auth.js";
import type { LoadedEndpoint } from "./domain.js";

const endpoint = {
  id: "endpoint-1",
  name: "Endpoint",
  slug: "endpoint",
  kind: "http",
  project: { id: "project-1", name: "Project", slug: "project" },
  environment: {
    id: "environment-1",
    name: "Development",
    slug: "development",
    logLevel: "debug",
    logRetentionDays: 7,
    logRetentionMaxEntries: 50000,
    logRetentionMaxBytes: 52428800,
  },
  deployment: { id: "deployment-1", version: 1, checksum: "checksum" },
  snapshot: {
    functions: [],
    functionCalls: [],
    mcpBindings: [],
    httpBindings: [],
    authPolicies: [],
    endpointAccessPolicy: { mode: "authenticated", allowedSubjects: [] },
    networkPolicy: {
      allowedHosts: [],
      allowedMethods: ["GET"],
      allowedPorts: [443],
      maxResponseBytes: 1_048_576,
      allowPrivateHosts: [],
    },
    env: {},
    libraries: [],
    capabilities: { reviewedDatabaseQueries: { enabled: false } },
    reviewedQueries: [],
  },
} satisfies LoadedEndpoint;

describe("ordered endpoint authentication", () => {
  it("tries policies serially until one authenticates", async () => {
    const request = { id: "request-1", headers: {} };
    await expect(
      authenticateWithPolicies(
        request as never,
        endpoint,
        [
          { id: "api-key", type: "api_key", config: { header: "x-api-key" } },
          { id: "public", type: "public", config: { permissions: ["read"] } },
        ],
        Buffer.alloc(32),
        { endpoint: "http" },
      ),
    ).resolves.toMatchObject({
      permissions: ["read"],
      claims: { authenticationPolicyId: "public" },
    });
  });

  it("returns the final authentication failure when none match", async () => {
    await expect(
      authenticateWithPolicies(
        { id: "request-2", headers: {} } as never,
        endpoint,
        [
          { id: "first", type: "api_key", config: { header: "x-first" } },
          { id: "second", type: "api_key", config: { header: "x-second" } },
        ],
        Buffer.alloc(32),
        { endpoint: "http" },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("does not bypass a selected policy configuration failure", async () => {
    await expect(
      authenticateWithPolicies(
        { id: "request-3", headers: { "x-api-key": "supplied" } } as never,
        endpoint,
        [
          { id: "broken", type: "api_key", config: { header: "x-api-key" } },
          { id: "public", type: "public", config: {} },
        ],
        Buffer.alloc(32),
        { endpoint: "http" },
      ),
    ).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
  });
});

describe("static endpoint credentials", () => {
  it("accepts only an exact API key", () => {
    expect(verifyStaticCredential("dev-acme-mcp-key", "dev-acme-mcp-key")).toBe(true);
    expect(verifyStaticCredential("dev-acme-mcp-key-x", "dev-acme-mcp-key")).toBe(
      false,
    );
  });
  it("maps explicit static permissions without policy roles or scopes", () => {
    expect(
      identityFromPolicy({
        id: "p",
        type: "api_key",
        config: { secretRef: "KEY", header: "x-api-key" },
      }),
    ).toMatchObject({ permissions: [] });
    expect(
      identityFromPolicy({
        id: "p",
        type: "api_key",
        config: {
          secretRef: "KEY",
          header: "x-api-key",
          permissions: ["read"],
        },
      }),
    ).toMatchObject({ permissions: ["read"] });
  });
  it("verifies an exact HTTP Basic authorization value", () => {
    const valid = `Basic ${Buffer.from("service-user:correct horse").toString("base64")}`;
    expect(verifyBasicAuthorization(valid, "service-user", "correct horse")).toBe(true);
    expect(verifyBasicAuthorization(valid, "service-user", "wrong")).toBe(false);
    expect(verifyBasicAuthorization(valid, "bad:user", "correct horse")).toBe(false);
  });
});
describe("endpoint access authorization", () => {
  it("is a distinct decision between authentication and function permissions", () => {
    const caller = { subject: "client-a", permissions: [], claims: {} };
    expect(() =>
      authorizeEndpointAccess(
        caller,
        { mode: "restricted", allowedSubjects: ["client-b"] },
        "r1",
      ),
    ).toThrow(/not allowed/);
    expect(() =>
      authorizeEndpointAccess(
        caller,
        { mode: "restricted", allowedSubjects: ["client-a"] },
        "r1",
      ),
    ).not.toThrow();
  });
});
describe("JWT/JWKS authentication", () => {
  it("requires explicit provider feature opt-in", () => {
    expect(runtimeAuthFeatureEnabled({}, "ENABLE_JWT_AUTH")).toBe(false);
    expect(
      runtimeAuthFeatureEnabled({ ENABLE_JWT_AUTH: "false" }, "ENABLE_JWT_AUTH"),
    ).toBe(false);
    expect(
      runtimeAuthFeatureEnabled({ ENABLE_JWT_AUTH: "true" }, "ENABLE_JWT_AUTH"),
    ).toBe(true);
  });
  it("validates issuer, audience, skew and required claims with JOSE", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "key-1";
    const key = createLocalJWKSet({ keys: [jwk] });
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      role: "mcp_user",
      scope: "customers.read",
      email: "user@example.test",
    })
      .setProtectedHeader({ alg: "RS256", kid: "key-1" })
      .setSubject("user-1")
      .setIssuer("https://issuer.example.test/")
      .setAudience("mcp-api")
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(privateKey);
    const config = jwtPolicyConfigSchema.parse({
      issuer: "https://issuer.example.test/",
      audience: "mcp-api",
      jwksUrl: "https://issuer.example.test/jwks",
      requiredClaims: { role: ["mcp_user", "mcp_admin"] },
      clockSkewSeconds: 30,
    });
    await expect(verifyJwtAccessToken(token, config, key, "r1")).resolves.toMatchObject(
      {
        subject: "user-1",
        email: "user@example.test",
        permissions: ["customers.read"],
      },
    );
    await expect(
      verifyJwtAccessToken(token, { ...config, audience: "wrong" }, key, "r1"),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      verifyJwtAccessToken(
        token,
        { ...config, requiredClaims: { role: ["admin"] } },
        key,
        "r1",
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
describe("Microsoft Entra runtime authentication", () => {
  it("normalizes tenants and maps token grants to permissions", async () => {
    const tenant = "11111111-1111-4111-8111-111111111111";
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "entra-1";
    const key = createLocalJWKSet({ keys: [jwk] });
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      tid: tenant.toUpperCase(),
      scp: "Mcp.Tools.Access customers.read",
      name: "Ada",
    })
      .setProtectedHeader({ alg: "RS256", kid: "entra-1" })
      .setSubject("entra-user")
      .setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`)
      .setAudience("api://mcpops")
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(privateKey);
    const config = entraPolicyConfigSchema.parse({
      tenantMode: "single_tenant",
      tenantId: tenant,
      audience: "api://mcpops",
    });
    await expect(
      verifyEntraAccessToken(token, config, key, "r2"),
    ).resolves.toMatchObject({
      subject: "entra-user",
      tenantId: tenant,
      permissions: ["Mcp.Tools.Access", "customers.read"],
    });
  });
});
describe("route webhook signatures", () => {
  it("uses exact raw JSON bytes, timestamp tolerance, constant-time HMAC, and replay rejection", async () => {
    const rawBody = Buffer.from('{"id":"evt_1", "amount":10}', "utf8");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const secret = "webhook-secret";
    const signature = createHmac("sha256", secret)
      .update(Buffer.concat([Buffer.from(timestamp + "."), rawBody]))
      .digest("hex");
    const config = webhookSignaturePolicyConfigSchema.parse({
      secretRef: "WEBHOOK_SECRET",
      permissions: ["webhooks.receive"],
    });
    const seen = new Set<string>();
    const replayStore = {
      async claim(key: string) {
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      },
    };
    const request = {
      headers: {
        "x-mcpops-timestamp": timestamp,
        "x-mcpops-signature": `sha256=${signature}`,
      },
      rawBody,
      config,
      secret,
      policyId: "policy-1",
      replayStore,
      requestId: "r3",
      now: new Date(),
    };
    await expect(verifyWebhookRequest(request)).resolves.toMatchObject({
      subject: "webhook:policy-1",
      permissions: ["webhooks.receive"],
    });
    await expect(verifyWebhookRequest(request)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      verifyWebhookRequest({
        ...request,
        replayStore: {
          async claim() {
            return true;
          },
        },
        rawBody: Buffer.from('{"id":"evt_2"}'),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(() => assertWebhookEndpoint("mcp", "r3")).toThrow(/HTTP route/);
    expect(() => assertWebhookEndpoint("http", "r3")).not.toThrow();
  });
});
