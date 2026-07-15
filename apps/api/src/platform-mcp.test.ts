import { describe, expect, it, vi } from "vitest";

vi.mock("./resources.js", () => ({
  controlPlaneState: {
    del: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

describe("platform MCP module", () => {
  it("initializes its tool catalog without module-order errors", async () => {
    const module = await import("./platform-mcp.js");
    expect(module).toMatchObject({
      registerPlatformMcpRoutes: expect.any(Function),
    });
    const names = module.platformTools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "secrets_list",
        "secret_create",
        "secret_set_value",
        "secret_delete",
        "function_secret_grants_get",
        "function_secret_grants_set",
        "auth_policies_list",
        "auth_policy_get",
        "auth_policy_create",
        "auth_policy_edit",
        "auth_policy_delete",
        "endpoint_auth_assign",
        "network_policy_get",
        "network_policy_edit",
        "executions_list",
        "execution_get",
        "execution_logs",
        "deployments_list",
        "deployment_get",
        "deployment_logs",
      ]),
    );
    expect(names).toHaveLength(new Set(names).size);
    expect(
      module.functionEditSchema.parse({
        function: "health-check",
        expectedVersion: 1,
        expectedChecksum: "a".repeat(64),
        changes: { timeoutMs: 30_000 },
      }),
    ).toMatchObject({ changes: { timeoutMs: 30_000 }, dryRun: true });
  });
});
