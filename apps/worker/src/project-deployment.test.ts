import { describe, expect, it } from "vitest";
import { projectDeploymentReadiness } from "./project-deployment.js";

describe("project deployment atomic activation", () => {
  it("waits until every endpoint artifact has built", () => {
    expect(projectDeploymentReadiness(["deploying", "building"])).toBe("waiting");
    expect(projectDeploymentReadiness(["deploying", "deploying"])).toBe("ready");
  });

  it("fails the whole project version when one endpoint fails", () => {
    expect(projectDeploymentReadiness(["deploying", "failed"])).toBe("failed");
  });
});
