import { Ajv, type ValidateFunction } from "ajv";
import { Client } from "pg";
import {
  SafeRuntimeError,
  type AuditWriter,
  type ReviewedDatabase,
  type SafeLogger,
} from "@mcpops/runtime-sdk";
import { validateReviewedReadQuery } from "@mcpops/shared";
import type { ReviewedQuerySnapshot } from "./domain.js";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  removeAdditional: false,
  coerceTypes: false,
});

export type ReviewedQueryResult = {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
};
export type ReviewedQueryAdapterRequest = {
  connectionString: string;
  sql: string;
  values: unknown[];
  timeoutMs: number;
  maxRows: number;
  signal: AbortSignal;
};
export interface ReviewedQueryAdapter {
  execute(request: ReviewedQueryAdapterRequest): Promise<Record<string, unknown>[]>;
}

type PgClient = {
  connect(): Promise<void>;
  query(
    input: string | { text: string; values?: unknown[] },
  ): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
};

/** PostgreSQL adapter that constrains even reviewed SQL with a read-only transaction and server-side row limit. */
export class PostgresReviewedQueryAdapter implements ReviewedQueryAdapter {
  constructor(
    private readonly createClient: (
      connectionString: string,
      timeoutMs: number,
    ) => PgClient = (connectionString, timeoutMs) =>
      new Client({
        connectionString,
        connectionTimeoutMillis: Math.min(timeoutMs, 5_000),
        application_name: "mcp-ops-studio-reviewed-query",
      }) as unknown as PgClient,
  ) {}

  async execute(
    request: ReviewedQueryAdapterRequest,
  ): Promise<Record<string, unknown>[]> {
    const client = this.createClient(request.connectionString, request.timeoutMs);
    let transaction = false;
    try {
      await abortable(client.connect(), request.signal);
      await client.query("BEGIN TRANSACTION READ ONLY");
      transaction = true;
      await client.query({
        text: "SELECT set_config('statement_timeout', $1, true)",
        values: [String(request.timeoutMs)],
      });
      const sql = request.sql.trim().replace(/;\s*$/, "");
      const boundedSql = `SELECT * FROM (${sql}) AS "__mcpops_reviewed_query" LIMIT $${request.values.length + 1}`;
      // node-postgres does not accept AbortSignal. Destroying a client with an active query closes its socket and stops the backend work.
      const result = await abortableQuery(
        client,
        { text: boundedSql, values: [...request.values, request.maxRows + 1] },
        request.signal,
      );
      await client.query("ROLLBACK");
      transaction = false;
      return result.rows;
    } finally {
      if (transaction) await client.query("ROLLBACK").catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }
}

export type ReviewedDatabaseOptions = {
  enabled: boolean;
  functionId: string;
  definitions: readonly ReviewedQuerySnapshot[];
  requestId: string;
  abortSignal: AbortSignal;
  resolveConnectionSecret(secretId: string): Promise<string>;
  adapter: ReviewedQueryAdapter;
  logger: SafeLogger;
  audit: AuditWriter;
};

/** Parent-process capability. The child can select a grant and provide data, but can never provide SQL or credentials. */
export class SnapshotReviewedDatabase implements ReviewedDatabase {
  private readonly validators = new Map<string, ValidateFunction>();
  constructor(private readonly options: ReviewedDatabaseOptions) {}

  async query(request: {
    connection: string;
    queryId: string;
    params: Record<string, unknown>;
  }): Promise<ReviewedQueryResult> {
    const started = performance.now();
    const identity = safeRequest(request, this.options.requestId);
    if (!this.options.enabled)
      throw configuration(
        "Reviewed database queries are disabled for this deployment.",
        this.options.requestId,
      );
    const definition = this.options.definitions.find(
      (item) =>
        item.functionId === this.options.functionId &&
        item.queryId === identity.queryId &&
        item.connection.name === identity.connection,
    );
    if (!definition)
      throw new SafeRuntimeError({
        code: "FORBIDDEN",
        message:
          "The function is not granted access to this reviewed query and connection.",
        requestId: this.options.requestId,
      });
    validateSqlContract(definition, this.options.requestId);
    validateParameters(
      definition,
      identity.params,
      this.validator(definition),
      this.options.requestId,
    );
    if (this.options.abortSignal.aborted) throw timeout(this.options.requestId);

    const metadata = {
      queryId: definition.queryId,
      queryVersion: definition.queryVersion,
      connection: definition.connection.name,
      queryDefinitionId: definition.queryDefinitionId,
      queryVersionId: definition.queryVersionId,
    };
    try {
      // Resolution occurs only after feature, grant, SQL, and parameter validation, and only by the immutable secret ID in the snapshot.
      const connectionString = await this.options.resolveConnectionSecret(
        definition.connection.secretId,
      );
      assertPostgresConnectionString(connectionString, this.options.requestId);
      const rows = await this.options.adapter.execute({
        connectionString,
        sql: definition.sql,
        values: definition.parameterOrder.map((name) => identity.params[name] ?? null),
        timeoutMs: definition.timeoutMs,
        maxRows: definition.maxRows,
        signal: this.options.abortSignal,
      });
      const result = capResult(
        rows,
        definition.maxRows,
        definition.maxBytes,
        this.options.requestId,
      );
      if (definition.resultSchema)
        validateResult(definition, result, this.options.requestId);
      const completed = {
        ...metadata,
        rowCount: result.rowCount,
        truncated: result.truncated,
        durationMs: Math.round(performance.now() - started),
      };
      this.options.logger.info("Reviewed database query completed", completed);
      await this.options.audit.write({
        action: "reviewed_query.executed",
        targetType: "reviewed_query",
        targetId: definition.queryDefinitionId,
        metadata: completed,
      });
      return result;
    } catch (error) {
      const safe = normalizeQueryError(
        error,
        this.options.requestId,
        this.options.abortSignal,
      );
      const failed = {
        ...metadata,
        errorCode: safe.code,
        durationMs: Math.round(performance.now() - started),
      };
      this.options.logger.warn("Reviewed database query failed", failed);
      await this.options.audit.write({
        action: "reviewed_query.failed",
        targetType: "reviewed_query",
        targetId: definition.queryDefinitionId,
        metadata: failed,
      });
      throw safe;
    }
  }

  private validator(definition: ReviewedQuerySnapshot): ValidateFunction {
    const existing = this.validators.get(definition.queryVersionId);
    if (existing) return existing;
    let compiled: ValidateFunction;
    try {
      compiled = ajv.compile(definition.parameterSchema);
    } catch {
      throw configuration(
        "The reviewed query parameter schema is invalid.",
        this.options.requestId,
      );
    }
    this.validators.set(definition.queryVersionId, compiled);
    return compiled;
  }
}

export function reviewedQueriesEnabled(
  environment: NodeJS.ProcessEnv,
  snapshotEnabled: boolean,
): boolean {
  return environment.ENABLE_REVIEWED_DB_QUERIES === "true" && snapshotEnabled;
}

function safeRequest(
  value: unknown,
  requestId: string,
): { connection: string; queryId: string; params: Record<string, unknown> } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw validation("The reviewed query request is invalid.", requestId);
  const request = value as Record<string, unknown>;
  const params = request.params;
  if (
    typeof request.connection !== "string" ||
    !request.connection ||
    request.connection.length > 128 ||
    typeof request.queryId !== "string" ||
    !request.queryId ||
    request.queryId.length > 256 ||
    !params ||
    typeof params !== "object" ||
    Array.isArray(params)
  ) {
    throw validation("The reviewed query request is invalid.", requestId);
  }
  if (
    Object.keys(request).some(
      (key) => !["connection", "queryId", "params"].includes(key),
    )
  )
    throw validation("The reviewed query request is invalid.", requestId);
  return {
    connection: request.connection,
    queryId: request.queryId,
    params: params as Record<string, unknown>,
  };
}

function validateParameters(
  definition: ReviewedQuerySnapshot,
  params: Record<string, unknown>,
  validator: ValidateFunction,
  requestId: string,
): void {
  const allowed = new Set(definition.parameterOrder);
  if (Object.keys(params).some((name) => !allowed.has(name)) || !validator(params))
    throw validation("The reviewed query parameters are invalid.", requestId);
}

function validateSqlContract(
  definition: ReviewedQuerySnapshot,
  requestId: string,
): void {
  try {
    validateReviewedReadQuery(definition.sql, definition.parameterOrder);
  } catch {
    throw configuration(
      "The reviewed query snapshot is not a safe read-only SELECT with exact parameter bindings.",
      requestId,
    );
  }
}

function assertPostgresConnectionString(value: string, requestId: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw configuration("The reviewed database connection is invalid.", requestId);
  }
  if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") || !url.hostname)
    throw configuration("The reviewed database connection is invalid.", requestId);
}

function capResult(
  rows: Record<string, unknown>[],
  maxRows: number,
  maxBytes: number,
  requestId: string,
): ReviewedQueryResult {
  const accepted: Record<string, unknown>[] = [];
  const candidates = rows.slice(0, maxRows);
  let truncated = rows.length > maxRows;
  for (const row of candidates) {
    const candidate = {
      rows: [...accepted, row],
      rowCount: accepted.length + 1,
      truncated: truncated || candidates.length > accepted.length + 1,
    };
    let bytes: number;
    try {
      bytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
    } catch {
      throw new SafeRuntimeError({
        code: "UPSTREAM_ERROR",
        message: "The reviewed database query returned an unsupported value.",
        requestId,
      });
    }
    if (bytes > maxBytes) {
      truncated = true;
      break;
    }
    accepted.push(row);
  }
  return {
    rows: accepted,
    rowCount: accepted.length,
    truncated: truncated || accepted.length < rows.length,
  };
}

function validateResult(
  definition: ReviewedQuerySnapshot,
  result: ReviewedQueryResult,
  requestId: string,
): void {
  const schema = definition.resultSchema;
  if (!schema) return;
  try {
    if (!ajv.compile(schema)(result)) throw new Error("invalid");
  } catch {
    throw new SafeRuntimeError({
      code: "UPSTREAM_ERROR",
      message: "The reviewed database query returned an invalid result.",
      requestId,
    });
  }
}

function normalizeQueryError(
  error: unknown,
  requestId: string,
  signal: AbortSignal,
): SafeRuntimeError {
  if (error instanceof SafeRuntimeError) return error;
  const value = error as { name?: string; code?: string };
  if (signal.aborted || value.name === "AbortError" || value.code === "57014")
    return timeout(requestId);
  return new SafeRuntimeError({
    code: "UPSTREAM_ERROR",
    message: "The reviewed database query could not be completed.",
    requestId,
    retryable: true,
  });
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted)
    return Promise.reject(new DOMException("Database query cancelled", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new DOMException("Database query cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
function abortableQuery(
  client: PgClient,
  input: { text: string; values: unknown[] },
  signal: AbortSignal,
): Promise<{ rows: Record<string, unknown>[] }> {
  if (signal.aborted)
    return Promise.reject(new DOMException("Database query cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      void client.end().catch(() => undefined);
      finish(() => reject(new DOMException("Database query cancelled", "AbortError")));
    };
    signal.addEventListener("abort", abort, { once: true });
    client.query(input).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
function timeout(requestId: string): SafeRuntimeError {
  return new SafeRuntimeError({
    code: "TIMEOUT",
    message: "The reviewed database query timed out or was cancelled.",
    requestId,
  });
}
function validation(message: string, requestId: string): SafeRuntimeError {
  return new SafeRuntimeError({ code: "VALIDATION_ERROR", message, requestId });
}
function configuration(message: string, requestId: string): SafeRuntimeError {
  return new SafeRuntimeError({ code: "CONFIGURATION_ERROR", message, requestId });
}
