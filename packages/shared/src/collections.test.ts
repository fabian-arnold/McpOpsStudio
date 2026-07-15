import { describe, expect, it } from "vitest";
import { collectionDefinitionSchema, collectionQuerySchema } from "./collections.js";

describe("data collection contracts", () => {
  it("accepts typed schemas, declared indexes, and bounded rich queries", () => {
    expect(
      collectionDefinitionSchema.parse({
        name: "Customers",
        slug: "customers",
        schema: {
          type: "object",
          properties: { status: { type: "string" }, score: { type: "number" } },
        },
        indexes: [{ name: "status_score", fields: ["status", "score"], kind: "btree" }],
      }),
    ).toMatchObject({ slug: "customers" });
    expect(
      collectionQuerySchema.parse({
        where: {
          and: [
            { field: "status", op: "eq", value: "active" },
            { field: "score", op: "gte", value: 10 },
          ],
        },
        orderBy: [{ field: "score", direction: "desc" }],
        limit: 50,
      }),
    ).toMatchObject({ limit: 50 });
  });

  it("rejects unsafe identifiers and unbounded pages", () => {
    expect(() =>
      collectionDefinitionSchema.parse({
        name: "Unsafe",
        slug: "unsafe-name",
        schema: { type: "object" },
      }),
    ).toThrow();
    expect(() => collectionQuerySchema.parse({ limit: 501 })).toThrow();
    expect(() =>
      collectionDefinitionSchema.parse({
        name: "Unsafe index",
        slug: "unsafe_index",
        schema: { type: "object" },
        indexes: [{ name: "bad;drop", fields: ["value"] }],
      }),
    ).toThrow();
  });
});
