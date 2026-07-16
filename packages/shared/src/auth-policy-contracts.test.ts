import { describe, expect, it } from "vitest";
import { authPolicyMutationSchema, customAuthResultSchema } from "./contracts.js";

describe("runtime authentication policy contracts", () => {
  it("requires an explicit policy for public unauthenticated access", () => {
    expect(
      authPolicyMutationSchema.parse({
        name: "Public read access",
        type: "public",
        config: { permissions: ["customers.read"] },
      }),
    ).toMatchObject({
      type: "public",
      config: { permissions: ["customers.read"] },
    });
  });
  it("validates JWT and Entra constraints", () => {
    expect(
      authPolicyMutationSchema.safeParse({
        name: "JWT",
        type: "jwt",
        config: {
          issuer: "https://issuer.test/",
          audience: "api",
          jwksUrl: "https://issuer.test/jwks",
          requiredClaims: { role: ["user"] },
        },
      }).success,
    ).toBe(true);
    expect(
      authPolicyMutationSchema.safeParse({
        name: "Entra",
        type: "entra_id",
        config: {
          tenantMode: "single_tenant",
          tenantId: "common",
          audience: "api://mcpops",
        },
      }).success,
    ).toBe(false);
  });
  it("defines one concrete raw-body HMAC webhook scheme", () => {
    const parsed = authPolicyMutationSchema.parse({
      name: "Webhook",
      type: "webhook_signature",
      config: { secretRef: "WEBHOOK_SECRET" },
    });
    expect(parsed.config).toMatchObject({
      algorithm: "hmac-sha256",
      header: "x-mcpops-signature",
      timestampHeader: "x-mcpops-timestamp",
      signaturePrefix: "sha256=",
      replayProtection: true,
      toleranceSeconds: 300,
    });
  });
  it("defines HTTP Basic with a username and write-only password secret", () => {
    const parsed = authPolicyMutationSchema.parse({
      name: "Internal basic",
      type: "basic_auth",
      config: { username: "service-user", secretRef: "BASIC_PASSWORD" },
    });
    expect(parsed.config).toMatchObject({
      header: "authorization",
      scheme: "Basic",
      username: "service-user",
      permissions: [],
    });
    expect(
      authPolicyMutationSchema.safeParse({
        name: "Bad basic",
        type: "basic_auth",
        config: { username: "bad:user", secretRef: "BASIC_PASSWORD" },
      }).success,
    ).toBe(false);
  });
  it("defines a project Function reference for custom authentication", () => {
    expect(
      authPolicyMutationSchema.parse({
        name: "Custom identity",
        type: "custom_function",
        config: { functionId: "11111111-1111-4111-8111-111111111111" },
      }),
    ).toMatchObject({
      type: "custom_function",
      config: { functionId: "11111111-1111-4111-8111-111111111111" },
    });
    expect(
      customAuthResultSchema.safeParse({
        authenticated: true,
        subject: "caller",
        tenantId: "tenant-1",
        permissions: [],
      }).success,
    ).toBe(false);
  });
});
