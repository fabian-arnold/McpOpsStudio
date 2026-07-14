import { describe, expect, it } from "vitest";
import { deploymentJobOptions } from "./deployment-queue.js";

describe("deployment job policy", () => {
  it("uses bounded exponential retries for transient finalization failures", () => {
    expect(deploymentJobOptions("deployment-id")).toMatchObject({
      jobId: "deployment-id",
      attempts: 5,
      backoff: { type: "exponential", delay: 1_000 },
    });
  });
});
