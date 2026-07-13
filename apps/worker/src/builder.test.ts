import { describe, expect, it } from "vitest";
import {
  bundleFunction,
  collectRequiredAuthPolicyIds,
  snapshotReferencedAuthPolicies,
  snapshotReviewedQueries,
  validateAuthPolicyConfig,
  validateAuthSecretReferences,
  validateCachePolicy,
  validateResponseMappingDefinition,
  validateRuntimeEnvironment,
} from "./builder.js";
import { resolveFunctionCallGraph } from "@mcpops/shared";

describe("project Function call graph", () => {
  const fn = (id: string, slug: string, code: string) => ({
    id,
    slug,
    name: slug,
    versions: [{ code }],
  });

  it("pins transitive literal calls from a endpoint entry Function", () => {
    const functions = [
      fn("entry", "agent_order", `export default async function handler(ctx) { return ctx.functions.call("get_order", {}); }`),
      fn("order", "get_order", `export default async function handler(ctx) { return ctx.functions.call("read_ticket", {}); }`),
      fn("ticket", "read_ticket", `export default async function handler() { return { ok: true }; }`),
      fn("unused", "unused", `export default async function handler() { return null; }`),
    ];

    const result = resolveFunctionCallGraph(functions, new Set(["entry"]));

    expect(result.functions.map((item) => item.id)).toEqual(["entry", "order", "ticket"]);
    expect(result.calls).toEqual([
      { callerFunctionId: "entry", calleeFunctionId: "order", calleeSlug: "get_order" },
      { callerFunctionId: "order", calleeFunctionId: "ticket", calleeSlug: "read_ticket" },
    ]);
  });

  it("rejects dynamic call targets and cycles before activation", () => {
    expect(() =>
      resolveFunctionCallGraph(
        [fn("entry", "entry", `export default async function handler(ctx, input) { return ctx.functions.call(input.slug, {}); }`)],
        new Set(["entry"]),
      ),
    ).toThrow(/dynamic ctx\.functions\.call/);

    expect(() =>
      resolveFunctionCallGraph(
        [
          fn("one", "one", `export default async function handler(ctx) { return ctx.functions.call("two", {}); }`),
          fn("two", "two", `export default async function handler(ctx) { return ctx.functions.call("one", {}); }`),
        ],
        new Set(["one"]),
      ),
    ).toThrow(/cycle detected: one -> two -> one/);
  });
});

describe("deployment function bundling", () => {
  it("emits ESM and an external source map from stdin", async () => {
    const result = await bundleFunction({
      code: `export default async function handler(_ctx, input: { value: number }) { return { value: input.value + 1 }; }`,
      inputSchema: {
        type: "object",
        required: ["value"],
        properties: { value: { type: "number" } },
      },
      outputSchema: {
        type: "object",
        required: ["value"],
        properties: { value: { type: "number" } },
      },
      libraries: [],
    });

    expect(result.code).toContain("export");
    expect(result.sourceMap).toContain('"version": 3');
  });

  it("identifies the Function source file in compiler failures", async () => {
    await expect(
      bundleFunction({
        code: "export default async function handler(input:) {}",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        libraries: [],
        sourcefile: "customer-search.ts",
      }),
    ).rejects.toThrow(/customer-search\.ts/);
  });
});
describe("declarative deployment policy validation", () => {
  it("accepts an explicit public policy with bounded Function permissions", () => {
    expect(() =>
      validateAuthPolicyConfig("public", {
        permissions: ["customers.read"],
      }),
    ).not.toThrow();
  });
  it("validates cache bounds and HTTP response mappings before activation", () => {
    expect(
      validateCachePolicy({ defaultTtlSeconds: 60, maxTtlSeconds: 300 }),
    ).toEqual({ defaultTtlSeconds: 60, maxTtlSeconds: 300 });
    expect(() =>
      validateCachePolicy({ defaultTtlSeconds: 600, maxTtlSeconds: 300 }),
    ).toThrow(/cannot exceed/);
    expect(
      validateResponseMappingDefinition({
        statusCode: 201,
        body: { id: "$.customer.id" },
      }),
    ).toBeTruthy();
    expect(() =>
      validateResponseMappingDefinition({ statusCode: 700 }),
    ).toThrow(/statusCode/);
  });
  it("requires explicit permission arrays for static identities", () => {
    expect(() =>
      validateAuthPolicyConfig("api_key", {
        header: "x-api-key",
        secretRef: "CLIENT_KEY",
      }),
    ).toThrow(/explicit permissions/);
    expect(() =>
      validateAuthPolicyConfig("api_key", {
        header: "x-api-key",
        secretRef: "CLIENT_KEY",
        permissions: [],
      }),
    ).not.toThrow();
    expect(() =>
      validateAuthPolicyConfig("basic_auth", {
        header: "authorization",
        scheme: "Basic",
        username: "service-user",
        secretRef: "BASIC_PASSWORD",
        permissions: [],
      }),
    ).not.toThrow();
  });
  it("validates JWT, Entra, and webhook provider configuration before snapshotting", () => {
    expect(() =>
      validateAuthPolicyConfig("jwt", {
        header: "authorization",
        scheme: "Bearer",
        issuer: "https://issuer.test/",
        jwksUrl: "https://issuer.test/jwks",
        audience: "api",
        requiredClaims: { role: ["user"] },
        clockSkewSeconds: 60,
      }),
    ).not.toThrow();
    expect(() =>
      validateAuthPolicyConfig("entra_id", {
        header: "authorization",
        scheme: "Bearer",
        tenantMode: "single_tenant",
        tenantId: "common",
        audience: "api://mcpops",
        allowedTenantIds: [],
        clockSkewSeconds: 60,
      }),
    ).toThrow(/tenant UUID/);
    expect(() =>
      validateAuthPolicyConfig("webhook_signature", {
        header: "x-signature",
        timestampHeader: "x-timestamp",
        secretRef: "WEBHOOK_KEY",
        algorithm: "hmac-sha256",
        signaturePrefix: "sha256=",
        replayProtection: true,
        toleranceSeconds: 300,
        permissions: [],
      }),
    ).not.toThrow();
  });
  it("preserves the ordered endpoint authentication chain for all bindings", () => {
    const ids = collectRequiredAuthPolicyIds(
      ["secondary", "default"],
      [{ enabled: true }],
      [{ enabled: true }, { enabled: true }, { enabled: false }],
    );
    expect(ids).toEqual(["secondary", "default"]);
    const config = {
      header: "x-api-key",
      secretRef: "CLIENT_KEY",
      permissions: [],
    };
    const snapshot = snapshotReferencedAuthPolicies("org", ids, [
      {
        id: "secondary",
        projectId: "org",
        name: "Secondary",
        type: "api_key",
        config,
      },
      {
        id: "default",
        projectId: "org",
        name: "Default",
        type: "api_key",
        config,
      },
    ]);
    expect(snapshot.map((policy) => policy.id)).toEqual(["secondary", "default"]);
    expect(snapshot[0]?.config).not.toBe(config);
    expect(() =>
      snapshotReferencedAuthPolicies("org", ids, []),
    ).toThrow(/missing or outside/);
    expect(() =>
      collectRequiredAuthPolicyIds([], [{ enabled: true }], []),
    ).toThrow(/authentication policy/);
    expect(() => validateAuthSecretReferences(["CLIENT_KEY"], [])).toThrow(
      /endpoint environment/,
    );
    expect(() =>
      validateAuthSecretReferences(["CLIENT_KEY"], ["CLIENT_KEY"]),
    ).not.toThrow();
  });
});

describe("immutable runtime environment", () => {
  it("accepts only explicit non-secret snapshot values", () => {
    expect(
      validateRuntimeEnvironment({ CRM_API_URL: "http://mock-crm:8090" }),
    ).toEqual({ CRM_API_URL: "http://mock-crm:8090" });
    expect(() => validateRuntimeEnvironment({ invalidName: "value" })).toThrow(
      /Invalid non-secret/,
    );
    expect(validateRuntimeEnvironment(undefined)).toEqual({});
    expect(() =>
      validateRuntimeEnvironment({ CRM_API_TOKEN: "plaintext" }),
    ).toThrow(/Secret-like/);
  });
});

describe("reviewed query snapshots", () => {
  const grant = {
    id: "grant-1",
    functionId: "function-1",
    queryDefinitionId: "definition-1",
    queryVersionId: "version-1",
    queryDefinition: {
      id: "definition-1",
      projectId: "org-1",
      environmentId: "env-1",
      queryId: "customers_search",
      connection: {
        id: "connection-1",
        projectId: "org-1",
        environmentId: "env-1",
        secretId: "secret-1",
        name: "analytics",
        enabled: true,
        secret: { id: "secret-1", projectId: "org-1", environmentId: "env-1" },
      },
    },
    queryVersion: {
      id: "version-1",
      queryDefinitionId: "definition-1",
      version: 2,
      sql: "SELECT id FROM customers WHERE tenant_id = $1",
      parameterOrder: ["tenant_id"],
      parameterSchema: {
        type: "object",
        required: ["tenant_id"],
        properties: { tenant_id: { type: "string" } },
      },
      resultSchema: null,
      timeoutMs: 2_000,
      maxRows: 100,
      maxBytes: 20_000,
      enabled: true,
    },
  };

  it("snapshots exact immutable versions and secret references without values", () => {
    const snapshot = snapshotReviewedQueries("org-1", "env-1", [grant]);
    expect(snapshot[0]).toMatchObject({
      grantId: "grant-1",
      functionId: "function-1",
      queryVersionId: "version-1",
      queryVersion: 2,
      connection: {
        id: "connection-1",
        name: "analytics",
        secretId: "secret-1",
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("encryptedValue");
  });

  it("rejects disabled, cross-environment, and duplicate function query identities", () => {
    expect(() =>
      snapshotReviewedQueries("org-1", "env-1", [
        { ...grant, queryVersion: { ...grant.queryVersion, enabled: false } },
      ]),
    ).toThrow(/disabled/);
    expect(() =>
      snapshotReviewedQueries("org-1", "other-env", [grant]),
    ).toThrow(/environment/);
    expect(() =>
      snapshotReviewedQueries("org-1", "env-1", [
        grant,
        {
          ...grant,
          id: "grant-2",
          queryVersionId: "version-2",
          queryVersion: { ...grant.queryVersion, id: "version-2" },
        },
      ]),
    ).toThrow(/duplicate/);
  });
});
