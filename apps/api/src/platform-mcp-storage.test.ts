import { describe, expect, it, vi } from "vitest";

vi.mock("./resources.js", () => ({ cacheInspector: {} }));

import { callStorageTool, storageTools } from "./platform-mcp-storage.js";

const definition = {
  name: "Customers",
  slug: "customers",
  description: "Tenant customer records",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["name", "score"],
    properties: {
      name: { type: "string" },
      score: { type: "number" },
    },
  },
  indexes: [{ name: "by_score", kind: "btree", fields: ["score"], unique: false }],
};

describe("Platform MCP storage tools", () => {
  it("previews a valid collection without accessing the database", async () => {
    const result = await callStorageTool(
      "storage_collection_create",
      "project-1",
      {
        userId: "user-1",
        role: "developer",
        scopes: ["mcpops:read", "mcpops:write"],
      },
      { definition },
    );

    expect(result).toMatchObject({
      dryRun: true,
      data: { definition: { slug: "customers" } },
    });
  });

  it("requires write scope for collection mutations", async () => {
    await expect(
      callStorageTool(
        "storage_collection_create",
        "project-1",
        { userId: "user-1", role: "developer", scopes: ["mcpops:read"] },
        { definition },
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE" });
  });

  it("publishes unique tool names and dry-run mutation defaults", () => {
    const names = storageTools.map((tool) => tool.name);
    expect(names).toHaveLength(new Set(names).size);
    expect(
      storageTools.find((tool) => tool.name === "storage_record_delete")?.inputSchema
        .properties,
    ).toMatchObject({ dryRun: { default: true } });
  });
});
