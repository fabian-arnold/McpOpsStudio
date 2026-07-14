import { describe, expect, it } from "vitest";
import {
  dashboardResponseSchema,
  deploymentSummarySchema,
  endpointObservabilitySchema,
} from "./contracts.js";

describe("observability response contracts", () => {
  it("accepts truthful unavailable cache and runtime states without sample values", () => {
    const parsed = endpointObservabilitySchema.parse({
      endpoints: {
        runtimeBaseUrl: "https://runtime.example.test",
        mcpUrl: "https://runtime.example.test/mcp/acme/service",
        httpBaseUrl: "https://runtime.example.test/http/acme/service",
      },
      telemetry: {
        calls: 0,
        failures: 0,
        errorRate: 0,
        averageLatencyMs: 0,
        p95LatencyMs: 0,
        comparisons: Object.fromEntries(
          ["calls", "failures", "errorRate", "averageLatencyMs", "p95LatencyMs"].map(
            (key) => [key, { current: 0, previous: 0, changePercent: 0 }],
          ),
        ),
        window: "24h",
      },
      runtimeHealth: {
        status: "unavailable",
        reachable: false,
        activeDeploymentLoadable: false,
        checkedAt: new Date(),
        dependencies: {
          controlPlaneDatabase: "healthy",
          cache: "unavailable",
          activeDeployment: "unavailable",
        },
      },
      securityPosture: {
        endpointAuthentication: "not_configured",
        defaultPolicy: null,
        snapshottedPolicyCount: 0,
        source: "database",
        network: {
          configured: false,
          allowedHostCount: 0,
          allowedMethods: [],
          maxResponseBytes: null,
        },
        trustedDeveloperExecution: true,
      },
      storageMetrics: {
        storage: {
          namespaces: 0,
          storedKeys: 0,
          activeKeys: 0,
          expiredKeys: 0,
          valuesExposed: false,
        },
        cache: {
          status: "unavailable",
          activeKeys: null,
          approximate: false,
          hitRate: null,
          hitRateAvailable: false,
          keyMaterialExposed: false,
        },
      },
    });
    expect(parsed.storageMetrics.cache.activeKeys).toBeNull();
  });

  it("requires null rather than a fabricated average when no builds completed", () => {
    expect(
      deploymentSummarySchema.parse({
        activeSnapshots: 0,
        sevenDayDeployments: 0,
        successfulDeployments: 0,
        failedDeployments: 0,
        inProgressDeployments: 0,
        averageBuildDurationMs: null,
      }).averageBuildDurationMs,
    ).toBeNull();
  });

  it("requires a complete 24-hour traffic series and dependency health", () => {
    const metric = { current: 0, previous: 0, changePercent: 0 };
    const parsed = dashboardResponseSchema.parse({
      context: {
        generatedAt: new Date(),
        window: "24h",
        previousWindow: "preceding_24h",
        bucketMinutes: 60,
      },
      stats: {
        endpoints: 0,
        calls24h: 0,
        failedCalls24h: 0,
        errorRate: 0,
        averageLatencyMs: 0,
        p95LatencyMs: 0,
        activeDeployments: 0,
      },
      comparisons: {
        calls: metric,
        failures: metric,
        errorRate: metric,
        averageLatencyMs: metric,
        p95LatencyMs: metric,
      },
      trafficBuckets: Array.from({ length: 24 }, (_, hour) => ({
        startedAt: new Date(Date.UTC(2026, 6, 9, hour)),
        calls: 0,
        failures: 0,
      })),
      health: {
        status: "healthy",
        database: "healthy",
        redis: "healthy",
        deployedEndpoints: 0,
        endpointsWithActiveSnapshot: 0,
        endpointsWithoutActiveSnapshot: 0,
        failedDeployments24h: 0,
      },
      activeDeployments: [],
      recentFailures: [],
    });
    expect(parsed.trafficBuckets).toHaveLength(24);
  });
});
