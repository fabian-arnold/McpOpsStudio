import { describe, expect, it } from "vitest";
import {
  authPolicyMutationSchema,
  functionCreateSchema,
  httpBindingSchema,
  installationSetupSchema,
  networkPolicyUpdateSchema,
} from "./contracts.js";

const draft = {
  name: "lookup",
  slug: "lookup",
  title: "Lookup",
  code: "export default async function handler() {}",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
};

describe("control-plane mutation contracts", () => {
  it("requires HTTPS for remote installation URLs and permits local setup", () => {
    const setup = {
      setupCode: "setup-code-at-least-16-characters",
      ownerEmail: "owner@example.com",
      ownerPassword: "long-owner-password",
      projectName: "Operations",
      projectSlug: "operations",
      starter: "clean",
    } as const;
    expect(
      installationSetupSchema.parse({
        ...setup,
        publicUrl: "http://localhost:8080",
      }).publicUrl,
    ).toBe("http://localhost:8080");
    expect(() =>
      installationSetupSchema.parse({
        ...setup,
        publicUrl: "http://studio.example.com",
      }),
    ).toThrow(/HTTPS/);
    expect(
      installationSetupSchema.parse({
        ...setup,
        publicUrl: "https://studio.example.com",
      }).publicUrl,
    ).toBe("https://studio.example.com");
  });

  it("accepts underscore function slugs used by the programming model", () => {
    expect(
      functionCreateSchema.parse({ ...draft, slug: "search_customers" }).slug,
    ).toBe("search_customers");
  });

  it("accepts only secret IDs and rejects the removed duplicate grant field", () => {
    const secretId = "8ec89d17-8202-4884-8034-6037a22189e4";
    expect(
      functionCreateSchema.parse({ ...draft, secretGrantIds: [secretId] })
        .secretGrantIds,
    ).toEqual([secretId]);
    expect(() =>
      functionCreateSchema.parse({ ...draft, secretGrants: ["CRM_TOKEN"] }),
    ).toThrow();
  });

  it("materializes explicit function permissions for static credentials", () => {
    const policy = authPolicyMutationSchema.parse({
      name: "Runtime key",
      type: "api_key",
      config: { header: "x-api-key", secretRef: "RUNTIME_KEY" },
    });
    expect(policy.config).toMatchObject({
      secretRef: "RUNTIME_KEY",
      permissions: [],
    });
  });

  it("requires private exceptions to be exact allowlisted hosts", () => {
    expect(() =>
      networkPolicyUpdateSchema.parse({
        allowedHosts: ["api.example.com"],
        allowedMethods: ["GET"],
        allowedPorts: [443],
        maxResponseBytes: 1024,
        allowPrivateHosts: ["10.0.0.1"],
      }),
    ).toThrow(/exact allowed host/);
    expect(
      networkPolicyUpdateSchema.parse({
        allowedHosts: ["10.0.0.1"],
        allowedMethods: ["GET"],
        allowedPorts: [443],
        maxResponseBytes: 1024,
        allowPrivateHosts: ["10.0.0.1"],
      }).allowPrivateHosts,
    ).toEqual(["10.0.0.1"]);
  });
  it("validates operational cache and HTTP response mapping contracts", () => {
    expect(
      functionCreateSchema.parse({
        ...draft,
        cachePolicy: { defaultTtlSeconds: 60, maxTtlSeconds: 300 },
      }).cachePolicy,
    ).toMatchObject({ defaultTtlSeconds: 60, maxTtlSeconds: 300 });
    expect(() =>
      functionCreateSchema.parse({
        ...draft,
        cachePolicy: { defaultTtlSeconds: 600, maxTtlSeconds: 300 },
      }),
    ).toThrow(/cannot exceed/);
    const binding = {
      functionId: "8ec89d17-8202-4884-8034-6037a22189e4",
      method: "POST",
      path: "/customers",
      enabled: true,
    } as const;
    expect(
      httpBindingSchema.parse({
        ...binding,
        responseMapping: {
          statusCode: 201,
          headers: { "x-id": "$.id" },
          body: { customerId: "$.id" },
        },
      }).responseMapping,
    ).toBeTruthy();
    expect(() =>
      httpBindingSchema.parse({
        ...binding,
        responseMapping: { statusCode: 700 },
      }),
    ).toThrow();
  });
});
