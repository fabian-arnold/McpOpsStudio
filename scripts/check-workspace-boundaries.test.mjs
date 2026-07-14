import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findCycles,
  importSpecifiers,
  validateFeatureImport,
} from "./check-workspace-boundaries.mjs";

describe("workspace boundary analysis", () => {
  it("extracts static, dynamic, and CommonJS dependency specifiers", () => {
    assert.deepEqual(
      importSpecifiers(
        `import x from "@mcpops/shared"; export { y } from './y.js'; import("@mcpops/db"); require("z")`,
      ),
      ["@mcpops/shared", "./y.js", "@mcpops/db", "z"],
    );
  });

  it("reports dependency cycles with their complete path", () => {
    const graph = new Map([
      ["api", new Set(["shared"])],
      ["shared", new Set(["db"])],
      ["db", new Set(["shared"])],
    ]);
    assert.deepEqual(findCycles(graph), ["shared -> db -> shared"]);
  });

  it("rejects feature-to-feature private imports", () => {
    assert.equal(
      validateFeatureImport(
        "apps/web/features/functions/editor.tsx",
        "@/features/deployments/internal/state",
      ),
      "apps/web/features/functions/editor.tsx deep-imports feature deployments; use its public entrypoint",
    );
    assert.equal(
      validateFeatureImport(
        "apps/web/features/functions/editor.tsx",
        "@/features/functions/components/panel",
      ),
      undefined,
    );
  });
});
