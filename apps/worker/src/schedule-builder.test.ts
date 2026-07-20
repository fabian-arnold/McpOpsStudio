import { describe, expect, it } from "vitest";
import { scheduleDeploymentFailure } from "./schedule-builder.js";

describe("schedule deployment failure details", () => {
  it("persists a bounded cause and affected Functions", () => {
    const result = scheduleDeploymentFailure(
      new Error(`failure ${"x".repeat(9_000)}`),
      [{ id: "function-1", name: "Orders", slug: "orders", version: 3 }],
    );

    expect(result.failureCause).toHaveLength(8_000);
    expect(result.failureMetadata).toEqual({
      functions: [
        {
          functionId: "function-1",
          functionName: "Orders",
          functionSlug: "orders",
          functionVersion: 3,
        },
      ],
    });
  });
});
