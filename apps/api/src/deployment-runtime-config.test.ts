import { describe, expect, it } from "vitest";
import { resolveDevelopmentRuntimeEnvironment } from "./deployment-runtime-config.js";

describe("development deployment runtime environment", () => {
  it("inherits project Environment variables for endpoints without local overrides", () => {
    expect(
      resolveDevelopmentRuntimeEnvironment(
        { CRM_API_URL: "http://mock-crm:8090" },
        {},
        { env: {} },
        { env: {} },
      ),
    ).toEqual({ CRM_API_URL: "http://mock-crm:8090" });
  });

  it("allows explicit endpoint runtime values to override Environment defaults", () => {
    expect(
      resolveDevelopmentRuntimeEnvironment(
        { CRM_API_URL: "http://mock-crm:8090", REGION: "development" },
        { env: { CRM_API_URL: "https://crm.example.com" } },
        {},
        {},
      ),
    ).toEqual({
      CRM_API_URL: "https://crm.example.com",
      REGION: "development",
    });
  });
});
