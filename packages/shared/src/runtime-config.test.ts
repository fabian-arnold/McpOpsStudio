import { describe, expect, it } from "vitest";
import {
  deploymentRuntimeConfigSchema,
  endpointSettingsUpdateSchema,
} from "./contracts.js";

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

  it("allows endpoint execution windows up to one hour", () => {
    const base = {
      name: "Long-running endpoint",
      slug: "long-running-endpoint",
      description: "",
      runtimeVersion: "1",
      env: {},
      endpointAccessPolicy: { mode: "authenticated", allowedSubjects: [] },
    } as const;
    expect(
      endpointSettingsUpdateSchema.parse({
        ...base,
        runtime: { timeoutMs: 3_600_000, maxConcurrentRequests: 1 },
      }).runtime.timeoutMs,
    ).toBe(3_600_000);
    expect(() =>
      endpointSettingsUpdateSchema.parse({
        ...base,
        runtime: { timeoutMs: 3_600_001, maxConcurrentRequests: 1 },
      }),
    ).toThrow();
  });
});
