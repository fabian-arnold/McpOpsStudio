import { describe, expect, it } from "vitest";
import { parseManifest } from "@mcpops/shared";
import { buildManifestPlan } from "./manifest-plan.js";

const state = {
  endpoint: { name: "Old", slug: "old", description: "", kind: "mcp" as const },
  functions: [
    {
      id: "f1",
      name: "search",
      enabled: true,
      riskLevel: "read",
      requiredPermissions: [],
    },
  ],
  mcpBindings: [
    {
      id: "m1",
      toolName: "old_tool",
      functionId: "f1",
      title: "Old",
      description: "",
      enabled: true,
    },
  ],
  httpBindings: [],
  authPolicies: [{ id: "p1", name: "runtime-key" }],
};

describe("manifest atomic plan", () => {
  it("describes creates, updates, and deletes exactly", () => {
    const manifest = parseManifest(
      JSON.stringify({
        endpoint: { kind: "mcp", name: "New", slug: "new" },
        auth: { policy: "runtime-key" },
        functions: [{ name: "search", riskLevel: "read" }],
        mcp: { tools: [{ toolName: "search", function: "search" }] },
      }),
      "json",
    );
    const plan = buildManifestPlan(state, manifest);
    expect(plan.valid).toBe(true);
    expect(plan.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "create",
          resource: "mcp_binding",
          key: "search",
        }),
        expect.objectContaining({
          operation: "delete",
          resource: "mcp_binding",
          key: "old_tool",
        }),
      ]),
    );
  });

  it("blocks missing executable source instead of fabricating a function", () => {
    const manifest = parseManifest(
      JSON.stringify({
        endpoint: { kind: "mcp", name: "New", slug: "new" },
        functions: [{ name: "missing", riskLevel: "read" }],
      }),
      "json",
    );
    expect(buildManifestPlan(state, manifest)).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ code: "MISSING_FUNCTION_SOURCE" })],
    });
  });
});
