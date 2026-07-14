import { describe, expect, it } from "vitest";
import { storagePatternFilter } from "./repository.js";

describe("storage wildcard patterns", () => {
  it("maps exact and single-wildcard patterns to scoped Prisma filters", () => {
    expect(storagePatternFilter("note:1")).toEqual({ key: "note:1" });
    expect(storagePatternFilter("note:*")).toEqual({
      key: { startsWith: "note:" },
    });
    expect(storagePatternFilter("*:draft")).toEqual({
      key: { endsWith: ":draft" },
    });
    expect(storagePatternFilter("note:*:draft")).toEqual({
      key: { startsWith: "note:", endsWith: ":draft" },
    });
    expect(storagePatternFilter("*")).toEqual({});
  });
});
