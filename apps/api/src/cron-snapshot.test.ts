import { describe, expect, it } from "vitest";
import { snapshotHasEnabledCronBinding } from "./cron-snapshot.js";

describe("snapshotHasEnabledCronBinding", () => {
  const snapshot = {
    slices: [
      {
        environment: { id: "development" },
        bindings: [
          { id: "enabled-binding", enabled: true },
          { id: "disabled-binding", enabled: false },
        ],
      },
    ],
  };

  it("finds enabled bindings in environment slices", () => {
    expect(snapshotHasEnabledCronBinding(snapshot, "enabled-binding")).toBe(true);
  });

  it("rejects disabled, missing, and legacy top-level bindings", () => {
    expect(snapshotHasEnabledCronBinding(snapshot, "disabled-binding")).toBe(false);
    expect(snapshotHasEnabledCronBinding(snapshot, "missing-binding")).toBe(false);
    expect(
      snapshotHasEnabledCronBinding(
        { bindings: [{ id: "enabled-binding", enabled: true }] },
        "enabled-binding",
      ),
    ).toBe(false);
  });
});
