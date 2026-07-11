import { describe, expect, it } from "vitest";
import { canonicalEndpointUrls, hourlyTraffic, policySummary, summarizeDeployments, summarizeExecutions } from "./analytics.js";

const now = new Date("2026-07-10T12:30:00.000Z");

describe("control-plane analytics", () => {
  it("builds comparable periods and an observed p95", () => {
    const summary = summarizeExecutions([
      { createdAt: new Date("2026-07-10T12:00:00Z"), durationMs: 10, status: "success" },
      { createdAt: new Date("2026-07-10T11:00:00Z"), durationMs: 100, status: "error" },
      { createdAt: new Date("2026-07-09T11:00:00Z"), durationMs: 20, status: "success" },
    ], now);
    expect(summary.current).toEqual({ calls: 2, failures: 1, errorRate: 50, averageLatencyMs: 55, p95LatencyMs: 100 });
    expect(summary.comparisons.calls).toEqual({ current: 2, previous: 1, changePercent: 100 });
  });

  it("creates real hourly buckets including failures", () => {
    const buckets = hourlyTraffic([
      { createdAt: new Date("2026-07-10T11:15:00Z"), durationMs: 5, status: "timeout" },
      { createdAt: new Date("2026-07-10T11:45:00Z"), durationMs: 5, status: "success" },
    ], now, 2);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ calls: 2, failures: 1 });
  });

  it("derives encoded canonical endpoint URLs from configured base URL", () => {
    expect(canonicalEndpointUrls("https://runtime.example.test/", "acme eu", "customer-ops")).toEqual({
      runtimeBaseUrl: "https://runtime.example.test",
      mcpUrl: "https://runtime.example.test/mcp/acme%20eu/customer-ops",
      httpBaseUrl: "https://runtime.example.test/http/acme%20eu/customer-ops",
    });
    expect(() => canonicalEndpointUrls("javascript:alert(1)", "acme", "service")).toThrow(/HTTP/);
  });

  it("derives auth posture only from immutable snapshot policy data when present", () => {
    expect(policySummary({ defaultAuthPolicyId: "p1", authPolicies: [{ id: "p1", name: "Production key", type: "api_key" }] }, null)).toEqual({
      endpointAuthentication: "enforced", defaultPolicy: { id: "p1", name: "Production key", type: "api_key" },
      snapshottedPolicyCount: 1, source: "active_snapshot",
    });
  });

  it("summarizes empty, failed, and completed deployments without fabricated duration", () => {
    expect(summarizeDeployments([], 0, now).averageBuildDurationMs).toBeNull();
    expect(summarizeDeployments([
      { status: "failed", createdAt: new Date("2026-07-10T10:00:00Z"), completedAt: new Date("2026-07-10T10:00:05Z") },
      { status: "active", createdAt: new Date("2026-07-10T11:00:00Z"), completedAt: new Date("2026-07-10T11:00:08Z") },
    ], 1, now)).toMatchObject({ activeSnapshots: 1, sevenDayDeployments: 2, successfulDeployments: 1, failedDeployments: 1, averageBuildDurationMs: 6500 });
  });
});
