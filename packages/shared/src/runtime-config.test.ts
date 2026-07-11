import { describe, expect, it } from "vitest";
import { deploymentRuntimeConfigSchema } from "./contracts.js";

describe("deployment runtime configuration", () => {
  it("accepts reviewed non-secret environment and access configuration", () => {
    expect(
      deploymentRuntimeConfigSchema.parse({
        env: { CRM_API_URL: "https://crm.example.com" },
        endpointAccessPolicy: {
          mode: "restricted",
          allowedSubjects: ["policy:runtime-key"],
        },
        network: { allowPrivateHosts: [] },
      }),
    ).toMatchObject({ env: { CRM_API_URL: "https://crm.example.com" } });
  });

  it("rejects host environment-style names and empty restricted ACLs", () => {
    expect(() =>
      deploymentRuntimeConfigSchema.parse({ env: { "bad-name": "value" } }),
    ).toThrow();
    expect(() =>
      deploymentRuntimeConfigSchema.parse({
        endpointAccessPolicy: { mode: "restricted", allowedSubjects: [] },
      }),
    ).toThrow("Restricted endpoint access requires at least one rule");
  });
});
