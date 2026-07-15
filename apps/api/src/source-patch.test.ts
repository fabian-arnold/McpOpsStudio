import { describe, expect, it } from "vitest";
import { applyUnifiedPatch } from "./source-patch.js";

describe("guarded source patches", () => {
  it("applies unified diff hunks", () => {
    expect(
      applyUnifiedPatch(
        "one\ntwo\nthree",
        "@@ -1,3 +1,3 @@\n one\n-two\n+second\n three",
      ),
    ).toBe("one\nsecond\nthree");
  });
  it("rejects stale context", () => {
    expect(() =>
      applyUnifiedPatch("one\nchanged", "@@ -1,2 +1,2 @@\n one\n-old\n+new"),
    ).toThrow("mismatch");
  });
});
