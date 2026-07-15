import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, groupBy } = vi.hoisted(() => ({
  findMany: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("@mcpops/db", () => ({
  prisma: {
    secret: { findMany },
    secretGrant: { groupBy },
  },
}));

import { callSecretTool } from "./platform-mcp-secrets.js";

describe("platform MCP Secret tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists value presence without returning encrypted or plaintext values", async () => {
    findMany.mockResolvedValue([
      {
        id: "secret-dev",
        name: "SAP_PASSWORD",
        encryptedValue: "ciphertext-that-must-not-leave",
        createdAt: new Date("2026-07-15T10:00:00Z"),
        updatedAt: new Date("2026-07-15T10:00:00Z"),
        environment: { id: "dev", name: "Development", slug: "development" },
      },
      {
        id: "secret-prod",
        name: "SAP_PASSWORD",
        encryptedValue: null,
        createdAt: new Date("2026-07-15T10:00:00Z"),
        updatedAt: new Date("2026-07-15T10:00:00Z"),
        environment: { id: "prod", name: "Production", slug: "production" },
      },
    ]);
    groupBy.mockResolvedValue([{ secretName: "SAP_PASSWORD", _count: { _all: 2 } }]);

    const result = await callSecretTool(
      "secrets_list",
      "project-1",
      {
        userId: "user-1",
        role: "admin",
        scopes: ["mcpops:read"],
      },
      {},
    );

    expect(JSON.stringify(result)).not.toContain("ciphertext-that-must-not-leave");
    expect(result).toMatchObject({
      data: {
        containsSecretValues: false,
        secrets: [
          {
            name: "SAP_PASSWORD",
            grantCount: 2,
            environments: [
              { environment: { slug: "development" }, hasValue: true },
              { environment: { slug: "production" }, hasValue: false },
            ],
          },
        ],
      },
    });
  });
});
