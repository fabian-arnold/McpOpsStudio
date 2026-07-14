import { describe, expect, it } from "vitest";
import { platformCapabilities } from "./capabilities.js";

describe("safe platform capability view", () => {
  it("reflects configured providers without returning configuration values", () => {
    const view = platformCapabilities({
      NODE_ENV: "production",
      EXECUTOR_PROVIDER: "container",
      ENABLE_JWT_AUTH: "true",
      ENABLE_ENTRA_AUTH: "false",
      MCP_OPS_DEMO_MODE: "false",
      SESSION_SECRET: "must-not-appear",
    });
    expect(view).toMatchObject({
      environment: "production",
      executor: { provider: "container", hostileCodeIsolation: true },
      authProviders: { jwt: "enabled", entraRuntime: "disabled" },
      runtimeCapabilities: {
        arbitraryPackageInstallation: false,
        reviewedDatabaseQueries: false,
        demoMode: false,
      },
    });
    expect(JSON.stringify(view)).not.toContain("must-not-appear");
  });

  it("enables reviewed queries only for the exact lowercase feature flag", () => {
    expect(
      platformCapabilities({ ENABLE_REVIEWED_DB_QUERIES: "true" }).runtimeCapabilities
        .reviewedDatabaseQueries,
    ).toBe(true);
    expect(
      platformCapabilities({ ENABLE_REVIEWED_DB_QUERIES: "TRUE" }).runtimeCapabilities
        .reviewedDatabaseQueries,
    ).toBe(false);
  });
});
