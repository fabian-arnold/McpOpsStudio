import { describe, expect, it } from "vitest";
import { inferFailedFunction, type FunctionSource } from "./deployment-failure.js";

const source = (id: string, code: string): FunctionSource => ({
  id,
  name: id,
  slug: id,
  version: 2,
  code,
});

describe("legacy deployment failure attribution", () => {
  it("identifies a unique Function from an esbuild token location", () => {
    expect(
      inferFailedFunction(
        'Build failed:\n../../../virtual/function.ts:1:14: ERROR: Expected ";" but found ":"',
        [source("broken", "const value = : true"), source("valid", "const value = true")],
      )?.id,
    ).toBe("broken");
  });

  it("does not guess when multiple Functions match", () => {
    expect(
      inferFailedFunction(
        'virtual/function.ts:1:14: ERROR: Expected ";" but found ":"',
        [source("one", "const value = : true"), source("two", "const value = : false")],
      ),
    ).toBeUndefined();
  });
});
