import { expect, it } from "vitest";
import { PostgresReviewedQueryAdapter } from "./reviewed-database.js";

it.skipIf(process.env.RUN_REVIEWED_QUERY_INTEGRATION !== "true")("executes a bounded parameterized SELECT against PostgreSQL", async () => {
  const connectionString = process.env.REVIEWED_QUERY_TEST_DATABASE_URL;
  if (!connectionString) throw new Error("REVIEWED_QUERY_TEST_DATABASE_URL is required for the reviewed query integration test");
  const controller = new AbortController();
  await expect(new PostgresReviewedQueryAdapter().execute({
    connectionString, sql: "SELECT $1::text AS value", values: ["reviewed"], timeoutMs: 2_000, maxRows: 5, signal: controller.signal
  })).resolves.toEqual([{ value: "reviewed" }]);
});
