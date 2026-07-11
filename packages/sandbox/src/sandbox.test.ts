import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  bundleFunction,
  decryptSecret,
  encryptSecret,
  hostMatchesAllowlist,
  isPrivateAddress,
  LocalChildProcessExecutor,
  privateResolutionAllowed,
} from "./index.js";
import type {
  RuntimeContext,
  ScopedCache,
  ScopedStorage,
} from "@mcpops/runtime-sdk";

describe("secret encryption", () => {
  it("authenticates AES-256-GCM ciphertext", () => {
    const key = randomBytes(32);
    const encrypted = encryptSecret("sensitive", key);
    expect(decryptSecret(encrypted, key)).toBe("sensitive");
    const parts = encrypted.split(":");
    const ciphertext = Buffer.from(parts[3]!, "base64url");
    ciphertext[0] = ciphertext[0]! ^ 1;
    parts[3] = ciphertext.toString("base64url");
    expect(() => decryptSecret(parts.join(":"), key)).toThrow(/authenticated/);
  });
});
describe("function bundling", () => {
  it("allows reviewed modules and rejects host imports", async () => {
    await expect(
      bundleFunction({
        code: `import { safeJson } from "@mcpops/shared/http"; export default async (_, input) => safeJson(input)`,
      }),
    ).resolves.toHaveProperty("checksum");
    await expect(
      bundleFunction({
        code: `import fs from "node:fs"; export default async () => fs`,
      }),
    ).rejects.toThrow(/not allowed/);
  });
});
describe("network policy", () => {
  it("blocks local and RFC1918 addresses", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });
  it("matches exact and subdomain-only wildcard allowlists", () => {
    expect(hostMatchesAllowlist("api.example.com", ["api.example.com"])).toBe(
      true,
    );
    expect(hostMatchesAllowlist("eu.example.com", ["*.example.com"])).toBe(
      true,
    );
    expect(hostMatchesAllowlist("example.com", ["*.example.com"])).toBe(false);
  });
  it("permits private resolution only for an explicit exact development host", () => {
    const base = {
      allowedHosts: ["mock-crm"],
      allowedMethods: ["GET"],
      allowedPorts: [8090],
      maxResponseBytes: 1024,
    };
    expect(privateResolutionAllowed("mock-crm", ["172.20.0.4"], base)).toBe(
      false,
    );
    expect(
      privateResolutionAllowed("mock-crm", ["172.20.0.4"], {
        ...base,
        allowPrivateHosts: ["mock-crm"],
      }),
    ).toBe(true);
    expect(
      privateResolutionAllowed("mock-crm", ["169.254.169.254"], {
        ...base,
        allowPrivateHosts: ["mock-crm"],
      }),
    ).toBe(false);
  });
});
describe("child-process execution", () => {
  it("executes immutable ESM without running in the caller process", async () => {
    const controller = new AbortController();
    const scoped: ScopedStorage = {
      async get() {
        return null;
      },
      async set() {},
      async delete() {},
      forTenant() {
        return this;
      },
    };
    const cache: ScopedCache = {
      async get() {
        return null;
      },
      async set() {},
      async delete() {},
      forTenant() {
        return this;
      },
      async getOrSet(_key, producer) {
        return producer();
      },
    };
    const context: RuntimeContext = {
      invocation: { source: "test", requestId: "request-1" },
      project: { id: "o", slug: "o", name: "Org" },
      environment: { id: "e", slug: "dev", name: "Development" },
      endpoint: { kind: "mcp", id: "s", slug: "svc", name: "Service" },
      function: { id: "f", name: "increment", riskLevel: "read" },
      caller: { permissions: [], claims: {} },
      permissions: [],
      env: {},
      secrets: {
        get() {
          throw new Error("not granted");
        },
      },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      http: {
        async request() {
          return { status: 200, headers: {}, data: null };
        },
      },
      storage: scoped,
      cache,
      audit: { async write() {} },
      db: {
        async query() {
          return null;
        },
      },
      functions: {
        call: async (slug, input) => ({ slug, input }),
      },
      abortSignal: controller.signal,
    };
    const result = await new LocalChildProcessExecutor().execute({
      compiledCode: `export default async function (ctx, input) { return { value: input.value + 1, internal: await ctx.functions.call("lookup", input) }; }`,
      input: { value: 1 },
      context,
      timeoutMs: 3_000,
    });
    expect(result).toMatchObject({
      status: "success",
      output: { value: 2, internal: { slug: "lookup", input: { value: 1 } } },
    });
  });
  it("proxies reviewed query IDs and parameters without exposing a database client", async () => {
    const controller = new AbortController();
    const observed: unknown[] = [];
    const scoped: ScopedStorage = {
      async get() {
        return null;
      },
      async set() {},
      async delete() {},
      forTenant() {
        return this;
      },
    };
    const cache: ScopedCache = {
      async get() {
        return null;
      },
      async set() {},
      async delete() {},
      forTenant() {
        return this;
      },
      async getOrSet(_key, producer) {
        return producer();
      },
    };
    const context: RuntimeContext = {
      invocation: { source: "test", requestId: "query-1" },
      project: { id: "o", slug: "o", name: "Org" },
      environment: { id: "e", slug: "dev", name: "Dev" },
      endpoint: { kind: "mcp", id: "s", slug: "svc", name: "Service" },
      function: { id: "f", name: "query", riskLevel: "read" },
      caller: { permissions: [], claims: {} },
      permissions: [],
      env: {},
      secrets: {
        get() {
          throw new Error("not granted");
        },
      },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      http: {
        async request() {
          return { status: 200, headers: {}, data: null };
        },
      },
      storage: scoped,
      cache,
      audit: { async write() {} },
      db: {
        async query(request) {
          observed.push(request);
          return { rows: [{ id: "cus_1" }], rowCount: 1, truncated: false };
        },
      },
      functions: { call: async () => null },
      abortSignal: controller.signal,
    };
    const result = await new LocalChildProcessExecutor().execute({
      compiledCode: `export default async function (ctx) { return ctx.db.query({ connection: "analytics", queryId: "customers.search", params: { tenantId: "acme" } }); }`,
      input: {},
      context,
      timeoutMs: 3_000,
    });
    expect(observed).toEqual([
      {
        connection: "analytics",
        queryId: "customers.search",
        params: { tenantId: "acme" },
      },
    ]);
    expect(result).toMatchObject({
      status: "success",
      output: { rowCount: 1, truncated: false },
    });
  });
  it("propagates cancellation as a real AbortSignal before termination", async () => {
    const controller = new AbortController();
    const observed: unknown[] = [];
    const scoped: ScopedStorage = {
      async get() {
        return null;
      },
      async set() {},
      async delete() {},
      forTenant() {
        return this;
      },
    };
    const cache: ScopedCache = {
      async get() {
        return null;
      },
      async set() {},
      async delete() {},
      forTenant() {
        return this;
      },
      async getOrSet(_key, producer) {
        return producer();
      },
    };
    const context: RuntimeContext = {
      invocation: { source: "test", requestId: "cancel-1" },
      project: { id: "o", slug: "o", name: "Org" },
      environment: { id: "e", slug: "dev", name: "Dev" },
      endpoint: { kind: "mcp", id: "s", slug: "svc", name: "Service" },
      function: { id: "f", name: "cancel", riskLevel: "read" },
      caller: { permissions: [], claims: {} },
      permissions: [],
      env: {},
      secrets: {
        get() {
          throw new Error("not granted");
        },
      },
      logger: {
        debug() {},
        info(_message, metadata) {
          observed.push(metadata?.aborted);
        },
        warn() {},
        error() {},
      },
      http: {
        async request() {
          return { status: 200, headers: {}, data: null };
        },
      },
      storage: scoped,
      cache,
      audit: { async write() {} },
      db: {
        async query() {
          return null;
        },
      },
      functions: { call: async () => null },
      abortSignal: controller.signal,
    };
    setTimeout(() => controller.abort(), 100);
    const result = await new LocalChildProcessExecutor().execute({
      compiledCode: `export default async function (ctx) { return new Promise((resolve) => { const onAbort = () => { ctx.logger.info("cancelled", { aborted: ctx.abortSignal.aborted }); resolve(null); }; if (ctx.abortSignal.aborted) onAbort(); else ctx.abortSignal.addEventListener("abort", onAbort, { once: true }); }); }`,
      input: {},
      context,
      timeoutMs: 3_000,
      abortController: controller,
    });
    expect(result.status).toBe("timeout");
    expect(observed).toContain(true);
  });
});
