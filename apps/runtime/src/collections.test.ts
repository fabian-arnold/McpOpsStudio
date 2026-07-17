import { describe, expect, it } from "vitest";
import {
  compileWhere,
  containsPlatformSecret,
  SnapshotCollections,
} from "./collections.js";

const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    score: { type: "number" },
    tags: { type: "array", items: { type: "string" } },
  },
};

describe("PostgreSQL collection query compilation", () => {
  it("opens granted collections without tenant context", () => {
    const collections = new SnapshotCollections(
      {
        snapshot: {
          collections: [
            {
              functionId: "function-1",
              slug: "customers",
              schema: { type: "object" },
            },
          ],
        },
      } as never,
      "function-1",
      "request-1",
    );
    expect(collections.collection("customers")).toBeDefined();
  });

  it("keeps caller values parameterized", () => {
    const injection = "x' OR true; DROP TABLE collection_records; --";
    const sql = compileWhere({ field: "name", op: "eq", value: injection }, schema);
    expect(sql.strings.join(" ")).not.toContain(injection);
    expect(sql.values).toContain(JSON.stringify(injection));
  });

  it("compiles nested predicates and rejects unknown fields", () => {
    const sql = compileWhere(
      {
        and: [
          { field: "score", op: "gte", value: 10 },
          { not: { field: "tags", op: "arrayContains", value: "blocked" } },
        ],
      },
      schema,
    );
    expect(sql.strings.join(" ")).toContain("AND");
    expect(() =>
      compileWhere({ field: "missing", op: "eq", value: true }, schema),
    ).toThrow(/Unknown collection field/);
  });

  it("does not treat a short secret embedded in an ordinary word as persisted", () => {
    expect(
      containsPlatformSecret(
        {
          mode: "incremental",
          message: "Platform secret values cannot be persisted in a data collection.",
        },
        ["form"],
      ),
    ).toBe(false);
  });

  it("detects direct, token-delimited, and long embedded secret values", () => {
    expect(containsPlatformSecret({ value: "abc" }, ["abc"])).toBe(true);
    expect(containsPlatformSecret({ value: "Bearer form" }, ["form"])).toBe(true);
    expect(
      containsPlatformSecret({ value: "prefix-super-secret-value-suffix" }, [
        "super-secret-value",
      ]),
    ).toBe(true);
  });
});
