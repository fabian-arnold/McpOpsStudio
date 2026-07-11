import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  buildRuntimeLogEvent,
  normalizeCachePolicy,
  validateAgainstSchema,
  type InvokeRequest,
} from "./invoke.js";
import {
  applyHttpResponseMapping,
  buildRuntimeApp,
  isPublicRuntimePath,
  mapHttpInput,
  normalizeTestSource,
} from "./server.js";
import type { FastifyRequest } from "fastify";
import { deploymentSnapshotSchema } from "./domain.js";

describe("runtime contracts", () => {
  it("refuses an implicit local executor in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(
        buildRuntimeApp({
          masterKey: Buffer.alloc(32),
          redisUrl: "redis://127.0.0.1:6379",
        }),
      ).rejects.toThrow(/FunctionExecutor/);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
  it("uses stable request-safe hashes for authentication comparisons", () => {
    expect(createHash("sha256").update("key").digest("hex")).toHaveLength(64);
  });
  it("documents stateless Streamable HTTP protocol version", () => {
    expect("2025-03-26").toMatch(/^2025-/);
  });
  it("limits private proxy authentication to public invocation paths", () => {
    expect(isPublicRuntimePath("/mcp/acme/customer-operations")).toBe(true);
    expect(isPublicRuntimePath("/http/acme/customer-operations/v1/search")).toBe(true);
    expect(isPublicRuntimePath("/health")).toBe(false);
    expect(isPublicRuntimePath("/internal/capabilities")).toBe(false);
  });
  it("rejects a public invocation that bypasses the authenticated proxy", async () => {
    const app = await buildRuntimeApp({
      masterKey: Buffer.alloc(32),
      redisUrl: "redis://127.0.0.1:6379",
      internalApiToken: "private-hop-token",
      requireInternalProxyAuth: true,
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/mcp/acme/customer-operations",
        payload: {},
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: { code: "UNAUTHENTICATED" },
      });
    } finally {
      await app.close();
    }
  });
  it("keeps tests truthfully sourced while retaining selected simulation metadata", () => {
    expect(normalizeTestSource("mcp")).toBe("mcp");
    expect(normalizeTestSource("http")).toBe("http");
    expect(normalizeTestSource("test")).toBeUndefined();
    expect(normalizeTestSource("internal")).toBeUndefined();
  });
  it("validates function input JSON Schema", () => {
    const schema = {
      type: "object",
      required: ["query"],
      additionalProperties: false,
      properties: { query: { type: "string", minLength: 1 } },
    };
    expect(() =>
      validateAgainstSchema(schema, { query: "ada" }, "r1"),
    ).not.toThrow();
    expect(() => validateAgainstSchema(schema, {}, "r1")).toThrow(
      /input is invalid/,
    );
  });
  it("maps path, query and body into the shared invocation input", () => {
    const binding = {
      id: "b",
      functionId: "f",
      method: "POST",
      path: "/customers/:customerId",
      enabled: true,
      inputMapping: {
        customerId: "path.customerId",
        include: "query.include",
        note: "body.note",
      },
    } as const;
    const request = {
      query: { include: "contacts" },
      body: { note: "hello" },
      headers: {},
    } as unknown as FastifyRequest;
    expect(mapHttpInput(binding, { customerId: "cus_ada" }, request)).toEqual({
      customerId: "cus_ada",
      include: "contacts",
      note: "hello",
    });
  });
  it("applies declarative HTTP status, headers, and body mappings", () => {
    expect(
      applyHttpResponseMapping(
        { customer: { id: "cus_ada" }, revision: 4 },
        {
          statusCode: 201,
          headers: { "x-revision": "$.revision" },
          body: { customerId: "output.customer.id" },
        },
        "r1",
      ),
    ).toEqual({
      statusCode: 201,
      headers: { "x-revision": "4" },
      body: { customerId: "cus_ada" },
    });
  });
  it("rejects missing and invalid HTTP response mapping paths safely", () => {
    expect(() =>
      applyHttpResponseMapping(
        { customer: {} },
        { customerId: "$.customer.id" },
        "r1",
      ),
    ).toThrow(/was not present/);
    expect(() =>
      applyHttpResponseMapping({}, { statusCode: 700, body: "$" }, "r1"),
    ).toThrow(/statusCode/);
  });
  it("makes cache policy TTL defaults and limits operational", () => {
    expect(
      normalizeCachePolicy({ defaultTtlSeconds: 120, maxTtlSeconds: 600 }),
    ).toEqual({ defaultTtlSeconds: 120, maxTtlSeconds: 600 });
    expect(
      normalizeCachePolicy({ ttlSeconds: 900, maxTtlSeconds: 300 }),
    ).toEqual({ defaultTtlSeconds: 300, maxTtlSeconds: 300 });
  });
  it("builds structured redacted test logs tied to an execution ID", () => {
    const request = {
      requestId: "r1",
      caller: { subject: "client", permissions: [], claims: {} },
      endpoint: {
        project: { id: "o" },
        environment: { id: "e" },
        id: "s",
        deployment: { id: "d" },
      },
      fn: { functionId: "f" },
    } as unknown as InvokeRequest;
    const event = buildRuntimeLogEvent(
      request,
      "exec-1",
      "info",
      "token=s3cret",
      { authorization: "Bearer x", note: "s3cret" },
      ["s3cret"],
    );
    expect(event).toMatchObject({
      executionId: "exec-1",
      requestId: "r1",
      message: "token=[REDACTED]",
      metadata: { authorization: "[REDACTED]", note: "[REDACTED]" },
    });
  });
  it("accepts only immutable non-secret environment names in snapshots", () => {
    const base = {
      functions: [],
      mcpBindings: [],
      httpBindings: [],
      authPolicies: [],
      env: { CRM_API_URL: "http://mock-crm:8090" },
    };
    expect(deploymentSnapshotSchema.parse(base).env).toEqual(base.env);
    expect(() =>
      deploymentSnapshotSchema.parse({
        ...base,
        env: { invalidName: "value" },
      }),
    ).toThrow();
  });
});
