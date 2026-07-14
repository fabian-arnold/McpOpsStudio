import { describe, expect, it } from "vitest";
import { normalizeFunctionBindings } from "./function-view.js";

describe("Function workbench binding view", () => {
  it("returns editable MCP and HTTP binding fields with safe endpoint metadata", () => {
    const endpoint = {
      id: "endpoint-1",
      name: "Customer Operations",
      slug: "customer-operations",
      kind: "mcp" as const,
    };
    const result = normalizeFunctionBindings(
      [{ id: "tool-1", functionId: "fn-1", toolName: "search", title: "Search", description: "Search customers", enabled: true, endpoint }],
      [{ id: "route-1", functionId: "fn-1", method: "POST", path: "/search", inputMapping: { query: "body.query" }, enabled: false, endpoint: { ...endpoint, kind: "http" } }],
    );

    expect(result.mcpBindings[0]).toMatchObject({ toolName: "search", endpoint: { id: "endpoint-1", kind: "mcp" } });
    expect(result.httpBindings[0]).toMatchObject({ method: "POST", path: "/search", inputMapping: { query: "body.query" }, responseMapping: null, endpoint: { kind: "http" } });
    expect(JSON.stringify(result)).not.toContain("activeDeployment");
  });
});
