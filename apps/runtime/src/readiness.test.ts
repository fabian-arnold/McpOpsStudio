import { describe, expect, it } from "vitest";
import { checkRuntimeReadiness } from "./readiness.js";
import { RuntimeMetrics, type RuntimeTelemetryExporter } from "./metrics.js";

describe("runtime readiness", () => {
  it("separates liveness from PostgreSQL, Redis, and active snapshot readiness", async () => {
    const ready = await checkRuntimeReadiness({ postgres: async () => undefined, redis: async () => undefined, activeDeployments: async () => 2 });
    expect(ready).toEqual({ ready: true, checks: { postgres: true, redis: true, activeDeployments: true }, activeDeploymentCount: 2 });
    const unavailable = await checkRuntimeReadiness({ postgres: async () => undefined, redis: async () => { throw new Error("offline"); }, activeDeployments: async () => 2 });
    expect(unavailable).toMatchObject({ ready: false, checks: { postgres: true, redis: false, activeDeployments: true } });
  });
});
describe("Prometheus runtime metrics", () => {
  it("exports counters, a real histogram, and database-synchronized gauges", async () => {
    const exported: string[] = []; const exporter: RuntimeTelemetryExporter = {
      async exportExecution(event) { exported.push(`execution:${event.status}`); }, async exportReadiness(event) { exported.push(`ready:${event.activeDeployments}`); }
    };
    const metrics = new RuntimeMetrics(exporter); metrics.recordRequest(); metrics.record("success", 125); metrics.recordReadiness({ postgres: true, redis: true, activeDeployments: true }, 3);
    const text = await metrics.render();
    expect(text).toContain("mcpops_runtime_requests_total 1"); expect(text).toContain("mcpops_function_execution_duration_seconds_bucket");
    expect(text).toContain("mcpops_active_deployments 3"); await Promise.resolve(); expect(exported).toEqual(["execution:success", "ready:3"]);
  });
});
