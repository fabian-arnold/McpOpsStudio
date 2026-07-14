import { Counter, Gauge, Histogram, Registry } from "prom-client";

export type ExecutionTelemetry = { status: string; durationMs: number };
export type ReadinessTelemetry = {
  ready: boolean;
  checks: Record<string, boolean>;
  activeDeployments: number;
};
/** Adapter boundary for a future OpenTelemetry exporter; metrics remain Prometheus-native in v1. */
export interface RuntimeTelemetryExporter {
  exportExecution(event: ExecutionTelemetry): Promise<void>;
  exportReadiness(event: ReadinessTelemetry): Promise<void>;
}
export class NoopRuntimeTelemetryExporter implements RuntimeTelemetryExporter {
  async exportExecution(): Promise<void> {}
  async exportReadiness(): Promise<void> {}
}

export class RuntimeMetrics {
  readonly registry = new Registry();
  private readonly requests: Counter;
  private readonly executions: Counter;
  private readonly duration: Histogram;
  private readonly activeDeployments: Gauge;
  private readonly dependencyReady: Gauge;

  constructor(
    private readonly exporter: RuntimeTelemetryExporter = new NoopRuntimeTelemetryExporter(),
  ) {
    this.requests = new Counter({
      name: "mcpops_runtime_requests_total",
      help: "Runtime HTTP requests received.",
      registers: [this.registry],
    });
    this.executions = new Counter({
      name: "mcpops_function_executions_total",
      help: "Function executions by terminal status.",
      labelNames: ["status"],
      registers: [this.registry],
    });
    this.duration = new Histogram({
      name: "mcpops_function_execution_duration_seconds",
      help: "Function execution duration in seconds.",
      labelNames: ["status"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
      registers: [this.registry],
    });
    this.activeDeployments = new Gauge({
      name: "mcpops_active_deployments",
      help: "Active immutable deployments loaded from PostgreSQL.",
      registers: [this.registry],
    });
    this.dependencyReady = new Gauge({
      name: "mcpops_runtime_dependency_ready",
      help: "Runtime dependency readiness (1 ready, 0 unavailable).",
      labelNames: ["dependency"],
      registers: [this.registry],
    });
  }
  recordRequest(): void {
    this.requests.inc();
  }
  record(status: string, durationMs: number): void {
    this.executions.inc({ status });
    this.duration.observe({ status }, durationMs / 1000);
    void this.exporter.exportExecution({ status, durationMs }).catch(() => undefined);
  }
  recordReadiness(checks: Record<string, boolean>, activeDeployments: number): void {
    for (const [dependency, ready] of Object.entries(checks))
      this.dependencyReady.set({ dependency }, ready ? 1 : 0);
    this.activeDeployments.set(activeDeployments);
    const ready = Object.values(checks).every(Boolean);
    void this.exporter
      .exportReadiness({ ready, checks, activeDeployments })
      .catch(() => undefined);
  }
  render(): Promise<string> {
    return this.registry.metrics();
  }
  get contentType(): string {
    return this.registry.contentType;
  }
}
