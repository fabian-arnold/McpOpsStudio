import { describe, expect, it, vi } from "vitest";

vi.mock("./resources.js", () => ({
  controlPlaneState: {
    del: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
  scheduleQueue: {
    add: vi.fn(),
    getJobSchedulers: vi.fn(),
  },
  cacheInspector: {},
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
        "cron_bindings_list",
        "cron_binding_get",
        "cron_binding_create",
        "cron_binding_edit",
        "cron_binding_delete",
        "cron_binding_run",
        "cron_binding_runs",
        "storage_collections_list",
        "storage_collection_get",
        "storage_collection_create",
        "storage_collection_version_create",
        "storage_collection_grant_set",
        "storage_collection_grant_delete",
        "storage_records_query",
        "storage_record_create",
        "storage_record_update",
        "storage_record_delete",
        "storage_cache_list",
        "storage_cache_reveal",
        "storage_cache_delete",
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
    const functionTest = module.platformTools.find(
      (tool) => tool.name === "function_test",
    );
    expect(functionTest?.inputSchema.properties).toMatchObject({
      cronBindingId: { type: "string" },
      source: { enum: ["mcp", "http", "cron", "test"] },
    });
    const collectionCreate = module.platformTools.find(
      (tool) => tool.name === "storage_collection_create",
    );
    expect(collectionCreate).toMatchObject({
      inputSchema: { required: ["definition"] },
      annotations: { readOnlyHint: false, destructiveHint: true },
    });
  }, 15_000);
});
