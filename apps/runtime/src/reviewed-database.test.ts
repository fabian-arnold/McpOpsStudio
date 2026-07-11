import { describe, expect, it, vi } from "vitest";
import type { AuditWriter, SafeLogger } from "@mcpops/runtime-sdk";
import { deploymentSnapshotSchema, type ReviewedQuerySnapshot } from "./domain.js";
import { PostgresReviewedQueryAdapter, reviewedQueriesEnabled, SnapshotReviewedDatabase, type ReviewedQueryAdapter } from "./reviewed-database.js";

const definition: ReviewedQuerySnapshot = {
  grantId: "grant-1", functionId: "function-1", queryDefinitionId: "definition-1", queryVersionId: "version-1",
  queryId: "customers.search", queryVersion: 3, connection: { id: "connection-1", name: "analytics", secretId: "secret-connection-1" },
  sql: "SELECT id, name FROM customers WHERE tenant_id = $1 AND name ILIKE $2", parameterOrder: ["tenantId", "query"],
  parameterSchema: { type: "object", required: ["tenantId", "query"], additionalProperties: false,
    properties: { tenantId: { type: "string" }, query: { type: "string" } } },
  timeoutMs: 2_000, maxRows: 2, maxBytes: 1_024
};

function harness(overrides: Partial<ConstructorParameters<typeof SnapshotReviewedDatabase>[0]> = {}) {
  const events: unknown[] = []; const logs: unknown[] = [];
  const adapter: ReviewedQueryAdapter = { execute: vi.fn(async () => [{ id: "1" }, { id: "2" }, { id: "3" }]) };
  const logger: SafeLogger = { debug: vi.fn(), info: vi.fn((message, metadata) => logs.push({ message, metadata })), warn: vi.fn((message, metadata) => logs.push({ message, metadata })), error: vi.fn() };
  const audit: AuditWriter = { write: vi.fn(async (event) => { events.push(event); }) };
  const resolveConnectionSecret = vi.fn(async () => "postgresql://reviewed:super-secret@db.example.test/analytics");
  const db = new SnapshotReviewedDatabase({ enabled: true, functionId: "function-1", definitions: [definition], requestId: "request-1",
    abortSignal: new AbortController().signal, resolveConnectionSecret, adapter, logger, audit, ...overrides });
  return { db, adapter, resolveConnectionSecret, events, logs };
}

describe("snapshot reviewed database capability", () => {
  it("validates immutable reviewed-query snapshots with the shared PostgreSQL AST policy", () => {
    const base = { functions: [], reviewedQueries: [definition], capabilities: { reviewedDatabaseQueries: { enabled: true } } };
    expect(deploymentSnapshotSchema.parse(base).reviewedQueries[0]?.queryId).toBe("customers.search");
    expect(() => deploymentSnapshotSchema.parse({ ...base, reviewedQueries: [{ ...definition, sql: "DELETE FROM customers WHERE tenant_id = $1" }] })).toThrow();
  });

  it("requires both the explicit environment flag and deployment capability", () => {
    expect(reviewedQueriesEnabled({ ENABLE_REVIEWED_DB_QUERIES: "true" }, true)).toBe(true);
    expect(reviewedQueriesEnabled({ ENABLE_REVIEWED_DB_QUERIES: "TRUE" }, true)).toBe(false);
    expect(reviewedQueriesEnabled({ ENABLE_REVIEWED_DB_QUERIES: "true" }, false)).toBe(false);
  });

  it("executes only the immutable granted query and caps returned rows", async () => {
    const { db, adapter, resolveConnectionSecret, events, logs } = harness();
    await expect(db.query({ connection: "analytics", queryId: "customers.search", params: { tenantId: "acme", query: "%ada%" } })).resolves.toEqual({
      rows: [{ id: "1" }, { id: "2" }], rowCount: 2, truncated: true
    });
    expect(resolveConnectionSecret).toHaveBeenCalledWith("secret-connection-1");
    expect(adapter.execute).toHaveBeenCalledWith(expect.objectContaining({ sql: definition.sql, values: ["acme", "%ada%"], timeoutMs: 2_000, maxRows: 2 }));
    const telemetry = JSON.stringify({ events, logs });
    expect(telemetry).toContain("customers.search");
    expect(telemetry).not.toContain("super-secret"); expect(telemetry).not.toContain("SELECT"); expect(telemetry).not.toContain("%ada%");
  });

  it("rejects an ungranted connection before resolving any credential", async () => {
    const { db, adapter, resolveConnectionSecret } = harness();
    await expect(db.query({ connection: "production", queryId: "customers.search", params: {} })).rejects.toMatchObject({ code: "FORBIDDEN", requestId: "request-1" });
    expect(resolveConnectionSecret).not.toHaveBeenCalled(); expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("validates parameters before resolving the connection secret", async () => {
    const { db, resolveConnectionSecret } = harness();
    await expect(db.query({ connection: "analytics", queryId: "customers.search", params: { tenantId: "acme", query: 12 } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(resolveConnectionSecret).not.toHaveBeenCalled();
  });

  it("rejects any caller-supplied SQL field", async () => {
    const { db, adapter, resolveConnectionSecret } = harness();
    const request = { connection: "analytics", queryId: "customers.search", params: { tenantId: "acme", query: "%ada%" }, sql: "DELETE FROM customers" };
    await expect(db.query(request)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(resolveConnectionSecret).not.toHaveBeenCalled(); expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("fails closed while the runtime feature is disabled", async () => {
    const { db, resolveConnectionSecret } = harness({ enabled: false });
    await expect(db.query({ connection: "analytics", queryId: "customers.search", params: {} })).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
    expect(resolveConnectionSecret).not.toHaveBeenCalled();
  });

  it("maps database cancellation to a safe timeout and never exposes the driver error", async () => {
    const adapter: ReviewedQueryAdapter = { execute: vi.fn(async () => { throw Object.assign(new Error("password super-secret failed"), { code: "57014" }); }) };
    const { db } = harness({ adapter });
    await expect(db.query({ connection: "analytics", queryId: "customers.search", params: { tenantId: "acme", query: "%ada%" } })).rejects.toMatchObject({
      code: "TIMEOUT", message: "The reviewed database query timed out or was cancelled."
    });
  });

  it("caps oversized result payloads without returning a partial oversized row", async () => {
    const adapter: ReviewedQueryAdapter = { execute: vi.fn(async () => [{ payload: "x".repeat(2_000) }]) };
    const { db } = harness({ adapter, definitions: [{ ...definition, maxRows: 10, maxBytes: 1_024 }] });
    await expect(db.query({ connection: "analytics", queryId: "customers.search", params: { tenantId: "acme", query: "%ada%" } })).resolves.toEqual({ rows: [], rowCount: 0, truncated: true });
  });
});

describe("PostgreSQL reviewed query adapter", () => {
  it("uses a read-only transaction, server timeout, positional parameters, and a server-side row cap", async () => {
    const calls: Array<string | { text: string; values?: unknown[] }> = [];
    const client = { connect: vi.fn(async () => undefined), query: vi.fn(async (input: string | { text: string; values?: unknown[] }) => {
      calls.push(input); return { rows: typeof input === "object" && input.text.startsWith("SELECT * FROM") ? [{ id: "1" }] : [] };
    }), end: vi.fn(async () => undefined) };
    const adapter = new PostgresReviewedQueryAdapter(() => client);
    const signal = new AbortController().signal;
    await expect(adapter.execute({ connectionString: "postgresql://ignored", sql: "SELECT id FROM customers WHERE tenant_id = $1;", values: ["acme"], timeoutMs: 900, maxRows: 25, signal })).resolves.toEqual([{ id: "1" }]);
    expect(calls[0]).toBe("BEGIN TRANSACTION READ ONLY");
    expect(calls[1]).toEqual({ text: "SELECT set_config('statement_timeout', $1, true)", values: ["900"] });
    expect(calls[2]).toEqual({ text: "SELECT * FROM (SELECT id FROM customers WHERE tenant_id = $1) AS \"__mcpops_reviewed_query\" LIMIT $2", values: ["acme", 26] });
    expect(calls[3]).toBe("ROLLBACK"); expect(client.end).toHaveBeenCalledOnce();
  });

  it("destroys the active PostgreSQL client when invocation cancellation is signalled", async () => {
    const controller = new AbortController(); let startQuery: () => void = () => {};
    const queryStarted = new Promise<void>((resolve) => { startQuery = resolve; });
    const client = { connect: vi.fn(async () => undefined), query: vi.fn((input: string | { text: string; values?: unknown[] }) => {
      if (typeof input === "object" && input.text.startsWith("SELECT * FROM")) { startQuery(); return new Promise<{ rows: Record<string, unknown>[] }>(() => undefined); }
      return Promise.resolve({ rows: [] });
    }), end: vi.fn(async () => undefined) };
    const adapter = new PostgresReviewedQueryAdapter(() => client);
    const pending = adapter.execute({ connectionString: "postgresql://ignored", sql: "SELECT id FROM customers", values: [], timeoutMs: 900, maxRows: 25, signal: controller.signal });
    await queryStarted; controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(client.end).toHaveBeenCalled();
  });
});
