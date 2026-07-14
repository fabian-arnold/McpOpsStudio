import { describe, expect, it } from "vitest";
import {
  reviewedDatabaseConnectionCreateSchema,
  reviewedQueryDefinitionCreateSchema,
  validateReviewedParameterSchema,
  validateReviewedReadQuery,
} from "./reviewed-database.js";

describe("reviewed PostgreSQL queries", () => {
  it("accepts connection metadata plus a secret reference and rejects plaintext URLs", () => {
    const metadata = {
      environmentId: "11111111-1111-4111-8111-111111111111",
      secretId: "22222222-2222-4222-8222-222222222222",
      name: "analytics",
    };
    expect(reviewedDatabaseConnectionCreateSchema.parse(metadata)).toMatchObject(
      metadata,
    );
    expect(() =>
      reviewedDatabaseConnectionCreateSchema.parse({
        ...metadata,
        connectionUrl: "postgresql://plaintext",
      }),
    ).toThrow();
    expect(() =>
      reviewedDatabaseConnectionCreateSchema.parse({
        ...metadata,
        encryptedValue: "ciphertext",
      }),
    ).toThrow();
  });

  it("accepts one bounded SELECT with exact positional parameters", () => {
    expect(
      validateReviewedReadQuery(
        "SELECT id, name FROM customers WHERE tenant_id = $1 AND name ILIKE $2",
        ["tenantId", "query"],
      ),
    ).toEqual({ parameterPositions: [1, 2] });
  });

  it.each([
    ["SELECT 1; SELECT 2", "exactly one"],
    ["UPDATE customers SET name = $1", "read-only SELECT"],
    [
      "WITH changed AS (DELETE FROM customers RETURNING id) SELECT * FROM changed",
      "read-only SELECT",
    ],
    ["SELECT pg_read_file('/etc/passwd')", "not allowed"],
    ["SELECT pg_advisory_lock(42)", "not allowed"],
    ["SELECT * FROM customers FOR UPDATE", "Row-locking"],
  ])("rejects unsafe SQL: %s", (sql, message) => {
    expect(() =>
      validateReviewedReadQuery(sql, sql.includes("$1") ? ["value"] : []),
    ).toThrow(message);
  });

  it("requires parameter order to match schema properties exactly", () => {
    expect(() =>
      validateReviewedParameterSchema(["tenantId"], {
        type: "object",
        properties: { tenantId: { type: "string" }, ignored: { type: "string" } },
      }),
    ).toThrow(/exactly once/);
  });

  it("rejects missing, sparse, or undeclared positional parameters", () => {
    expect(() =>
      validateReviewedReadQuery("SELECT * FROM customers WHERE id = $2", [
        "id",
        "other",
      ]),
    ).toThrow(/match parameterOrder/);
    expect(() => validateReviewedReadQuery("SELECT * FROM customers", ["id"])).toThrow(
      /match parameterOrder/,
    );
  });

  it("requires object parameter schemas and bounded execution limits", () => {
    const base = {
      environmentId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222",
      queryId: "customers.search",
      name: "Customer search",
      sql: "SELECT id FROM customers WHERE tenant_id = $1",
      parameterOrder: ["tenant_id"],
      parameterSchema: {
        type: "object",
        properties: { tenant_id: { type: "string" } },
      },
    };
    expect(reviewedQueryDefinitionCreateSchema.parse(base).timeoutMs).toBe(5_000);
    expect(() =>
      reviewedQueryDefinitionCreateSchema.parse({
        ...base,
        queryId: "Customers Search",
      }),
    ).toThrow(/dotted logical/);
    expect(() =>
      reviewedQueryDefinitionCreateSchema.parse({
        ...base,
        parameterSchema: { type: "array" },
      }),
    ).toThrow(/type: object/);
    expect(() =>
      reviewedQueryDefinitionCreateSchema.parse({ ...base, maxRows: 100_000 }),
    ).toThrow();
  });
});
