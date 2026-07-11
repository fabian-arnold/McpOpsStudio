import { parse } from "pgsql-ast-parser";
import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "Use a lowercase SQL-safe identifier");
const parameterName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, "Use a valid parameter name");
const logicalQueryId = z.string().max(256).regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/, "Use a lowercase dotted logical query ID");
const jsonSchemaObject = z.record(z.unknown()).superRefine((value, context) => {
  if (value.type !== "object") context.addIssue({ code: z.ZodIssueCode.custom, message: "Parameter schema must be a JSON Schema object with type: object" });
});

export const reviewedDatabaseConnectionCreateSchema = z.object({
  environmentId: z.string().uuid(),
  secretId: z.string().uuid(),
  name: identifier,
  description: z.string().max(500).default(""),
}).strict();

export const reviewedQueryVersionCreateSchema = z.object({
  sql: z.string().trim().min(1).max(100_000),
  parameterOrder: z.array(parameterName).max(100).refine((items) => new Set(items).size === items.length, "Parameter names must be unique"),
  parameterSchema: jsonSchemaObject,
  resultSchema: z.record(z.unknown()).optional(),
  timeoutMs: z.number().int().min(100).max(30_000).default(5_000),
  maxRows: z.number().int().min(1).max(10_000).default(100),
  maxBytes: z.number().int().min(1_024).max(10_485_760).default(1_048_576),
  enabled: z.boolean().default(true),
}).strict();

export const reviewedQueryDefinitionCreateSchema = reviewedQueryVersionCreateSchema.extend({
  environmentId: z.string().uuid(),
  connectionId: z.string().uuid(),
  queryId: logicalQueryId,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1_000).default(""),
}).strict();

export const functionQueryGrantCreateSchema = z.object({ queryVersionId: z.string().uuid() }).strict();

const disallowedFunctions = new Set([
  "clock_timestamp", "current_setting", "dblink", "dblink_connect", "dblink_exec",
  "gen_random_uuid", "lo_export", "lo_import", "nextval", "pg_ls_dir", "pg_read_binary_file",
  "pg_read_file", "pg_sleep", "pg_stat_file", "random", "set_config", "setval",
  "statement_timestamp", "timeofday", "transaction_timestamp",
]);
const disallowedSchemas = new Set(["dblink", "pg_catalog", "pg_temp"]);
const identityKeywords = new Set(["current_role", "current_user", "session_user", "user"]);

export type ReviewedSqlValidation = { parameterPositions: number[] };

/**
 * Parses PostgreSQL SQL and admits exactly one read-only SELECT tree. The parser
 * prevents semicolon/comment tricks from bypassing statement classification;
 * the recursive walk rejects modifying CTEs, row locks, identity leakage and
 * known volatile/server-side file or connection functions.
 */
export function validateReviewedReadQuery(sql: string, parameterOrder: readonly string[]): ReviewedSqlValidation {
  let statements: unknown[];
  try {
    statements = parse(sql) as unknown[];
  } catch {
    throw new Error("Reviewed query SQL is not valid PostgreSQL");
  }
  if (statements.length !== 1) throw new Error("Reviewed queries must contain exactly one statement");
  assertReadOnlySelect(statements[0]);

  const positions = new Set<number>();
  walk(statements[0], (node) => {
    if (node.type === "parameter") {
      const name = typeof node.name === "string" ? node.name : "";
      const match = /^\$(\d+)$/.exec(name);
      if (!match || Number(match[1]) < 1) throw new Error("Reviewed queries may use only positional PostgreSQL parameters");
      positions.add(Number(match[1]));
    }
    if (node.type === "call") {
      const qname = asRecord(node.function);
      const functionName = typeof qname.name === "string" ? qname.name.toLowerCase() : "";
      const schema = typeof qname.schema === "string" ? qname.schema.toLowerCase() : "";
      if (disallowedFunctions.has(functionName) || disallowedSchemas.has(schema) || functionName.startsWith("dblink_") || functionName.startsWith("pg_") || functionName.startsWith("lo_")) {
        throw new Error(`Function '${functionName || "unknown"}' is not allowed in reviewed queries`);
      }
    }
    if (node.type === "keyword" && identityKeywords.has(String(node.keyword).toLowerCase())) {
      throw new Error("Session identity keywords are not allowed in reviewed queries");
    }
  });

  const ordered = [...positions].sort((left, right) => left - right);
  const expected = parameterOrder.map((_, index) => index + 1);
  if (ordered.length !== expected.length || ordered.some((value, index) => value !== expected[index])) {
    throw new Error("SQL positional parameters must match parameterOrder exactly ($1 through $N)");
  }
  return { parameterPositions: ordered };
}

export function validateReviewedParameterSchema(parameterOrder: readonly string[], parameterSchema: Record<string, unknown>): void {
  const properties = asRecord(parameterSchema.properties);
  const declared = Object.keys(properties).sort();
  const ordered = [...parameterOrder].sort();
  if (declared.length !== ordered.length || declared.some((name, index) => name !== ordered[index])) {
    throw new Error("parameterOrder must name every parameterSchema property exactly once");
  }
}

function assertReadOnlySelect(value: unknown): void {
  const statement = asRecord(value);
  if (statement.type === "select") {
    if (statement.for !== undefined && statement.for !== null) throw new Error("Row-locking SELECT clauses are not allowed");
    return;
  }
  if (statement.type === "union" || statement.type === "union all") {
    assertReadOnlySelect(statement.left);
    assertReadOnlySelect(statement.right);
    return;
  }
  if (statement.type === "with" || statement.type === "with recursive") {
    const bindings = Array.isArray(statement.bind) ? statement.bind : [statement.bind];
    for (const binding of bindings) {
      const row = asRecord(binding);
      assertReadOnlySelect(row.statement ?? row);
    }
    assertReadOnlySelect(statement.in);
    return;
  }
  throw new Error("Reviewed queries must be a read-only SELECT; DDL, DML and transaction statements are forbidden");
}

function walk(value: unknown, visitor: (node: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
    return;
  }
  const node = value as Record<string, unknown>;
  visitor(node);
  for (const nested of Object.values(node)) walk(nested, visitor);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
