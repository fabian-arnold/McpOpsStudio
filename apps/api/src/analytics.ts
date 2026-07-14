export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

export type ExecutionSample = {
  createdAt: Date;
  durationMs: number;
  status: string;
};

const failedStatuses = new Set(["error", "timeout", "validation_error", "denied"]);

export type PeriodMetric = {
  current: number;
  previous: number;
  changePercent: number | null;
};

export type ExecutionPeriodSummary = {
  current: {
    calls: number;
    failures: number;
    errorRate: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
  };
  previous: {
    calls: number;
    failures: number;
    errorRate: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
  };
  comparisons: {
    calls: PeriodMetric;
    failures: PeriodMetric;
    errorRate: PeriodMetric;
    averageLatencyMs: PeriodMetric;
    p95LatencyMs: PeriodMetric;
  };
};

function rounded(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return rounded(((current - previous) / previous) * 100, 1);
}

export function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function period(samples: ExecutionSample[]) {
  const calls = samples.length;
  const failures = samples.filter((sample) => failedStatuses.has(sample.status)).length;
  const durations = samples.map((sample) => sample.durationMs);
  return {
    calls,
    failures,
    errorRate: calls ? rounded((failures / calls) * 100, 1) : 0,
    averageLatencyMs: calls
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / calls)
      : 0,
    p95LatencyMs: percentile(durations, 0.95),
  };
}

export function summarizeExecutions(
  samples: ExecutionSample[],
  now = new Date(),
): ExecutionPeriodSummary {
  const currentStart = new Date(now.getTime() - DAY_MS);
  const previousStart = new Date(now.getTime() - 2 * DAY_MS);
  const current = period(
    samples.filter(
      (sample) => sample.createdAt >= currentStart && sample.createdAt <= now,
    ),
  );
  const previous = period(
    samples.filter(
      (sample) => sample.createdAt >= previousStart && sample.createdAt < currentStart,
    ),
  );
  const comparison = (key: keyof typeof current): PeriodMetric => ({
    current: current[key],
    previous: previous[key],
    changePercent: percentChange(current[key], previous[key]),
  });
  return {
    current,
    previous,
    comparisons: {
      calls: comparison("calls"),
      failures: comparison("failures"),
      errorRate: comparison("errorRate"),
      averageLatencyMs: comparison("averageLatencyMs"),
      p95LatencyMs: comparison("p95LatencyMs"),
    },
  };
}

export function hourlyTraffic(
  samples: ExecutionSample[],
  now = new Date(),
  hours = 24,
) {
  const end = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS);
  const start = new Date(end.getTime() - hours * HOUR_MS);
  const buckets = Array.from({ length: hours }, (_, index) => ({
    startedAt: new Date(start.getTime() + index * HOUR_MS).toISOString(),
    calls: 0,
    failures: 0,
  }));
  for (const sample of samples) {
    const index = Math.floor((sample.createdAt.getTime() - start.getTime()) / HOUR_MS);
    const bucket = buckets[index];
    if (!bucket || sample.createdAt >= end) continue;
    bucket.calls += 1;
    if (failedStatuses.has(sample.status)) bucket.failures += 1;
  }
  return buckets;
}

export function canonicalEndpointUrls(
  baseUrl: string,
  projectSlug: string,
  endpointSlug: string,
  pathSuffix = "",
) {
  const configured = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(configured.protocol) ||
    configured.username ||
    configured.password
  ) {
    throw new Error("Environment baseUrl must be an HTTP(S) URL without credentials.");
  }
  const base = `${configured.origin}${configured.pathname}`.replace(/\/+$/, "");
  return {
    runtimeBaseUrl: base,
    mcpUrl: `${base}/mcp${pathSuffix}/${encodeURIComponent(projectSlug)}/${encodeURIComponent(endpointSlug)}`,
    httpBaseUrl: `${base}/http${pathSuffix}/${encodeURIComponent(projectSlug)}/${encodeURIComponent(endpointSlug)}`,
  };
}

export function canonicalEnvironmentEndpointUrls(
  environments: Array<{ slug: string; baseUrl: string }>,
  projectSlug: string,
  endpointSlug: string,
) {
  return Object.fromEntries(
    environments.map((environment) => [
      environment.slug,
      canonicalEndpointUrls(
        environment.baseUrl,
        projectSlug,
        endpointSlug,
        environment.slug === "development" ? "-dev" : "",
      ),
    ]),
  );
}

type AuthPolicyLike = {
  id: string;
  name?: string;
  type: string;
  config?: unknown;
};
type SnapshotLike = {
  authPolicies?: AuthPolicyLike[];
  defaultAuthPolicyId?: string | null;
};

export function policySummary(
  snapshotValue: unknown,
  databaseDefault?: AuthPolicyLike | null,
) {
  const snapshot =
    snapshotValue && typeof snapshotValue === "object"
      ? (snapshotValue as SnapshotLike)
      : {};
  const policies = Array.isArray(snapshot.authPolicies) ? snapshot.authPolicies : [];
  const defaultPolicy =
    policies.find((policy) => policy.id === snapshot.defaultAuthPolicyId) ??
    databaseDefault ??
    null;
  return {
    endpointAuthentication: defaultPolicy
      ? ("enforced" as const)
      : ("not_configured" as const),
    defaultPolicy: defaultPolicy
      ? {
          id: defaultPolicy.id,
          name: defaultPolicy.name ?? defaultPolicy.type,
          type: defaultPolicy.type,
        }
      : null,
    snapshottedPolicyCount: policies.length,
    source: policies.length ? ("active_snapshot" as const) : ("database" as const),
  };
}

export type DeploymentSample = {
  status: string;
  createdAt: Date;
  completedAt: Date | null;
};

export function summarizeDeployments(
  deployments: DeploymentSample[],
  activeSnapshots: number,
  now = new Date(),
) {
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const recent = deployments.filter(
    (deployment) => deployment.createdAt >= since && deployment.createdAt <= now,
  );
  const completedDurations = recent
    .filter(
      (deployment) =>
        deployment.completedAt &&
        ["active", "rolled_back", "failed"].includes(deployment.status),
    )
    .map((deployment) =>
      Math.max(0, deployment.completedAt!.getTime() - deployment.createdAt.getTime()),
    );
  return {
    activeSnapshots,
    sevenDayDeployments: recent.length,
    successfulDeployments: recent.filter((deployment) =>
      ["active", "rolled_back"].includes(deployment.status),
    ).length,
    failedDeployments: recent.filter((deployment) => deployment.status === "failed")
      .length,
    inProgressDeployments: deployments.filter((deployment) =>
      ["queued", "building", "deploying"].includes(deployment.status),
    ).length,
    averageBuildDurationMs: completedDurations.length
      ? Math.round(
          completedDurations.reduce((sum, value) => sum + value, 0) /
            completedDurations.length,
        )
      : null,
  };
}

export type GlobalProjectExecutionSample = {
  projectId: string;
  status: string;
  count: number;
  totalDurationMs: number;
};

export function summarizeGlobalProjectExecutions(
  samples: GlobalProjectExecutionSample[],
) {
  const byProject = new Map<
    string,
    { calls: number; failures: number; totalDurationMs: number }
  >();
  for (const sample of samples) {
    const summary = byProject.get(sample.projectId) ?? {
      calls: 0,
      failures: 0,
      totalDurationMs: 0,
    };
    summary.calls += sample.count;
    summary.totalDurationMs += sample.totalDurationMs;
    if (failedStatuses.has(sample.status)) summary.failures += sample.count;
    byProject.set(sample.projectId, summary);
  }
  return new Map(
    [...byProject].map(([projectId, summary]) => [
      projectId,
      {
        calls24h: summary.calls,
        failedCalls24h: summary.failures,
        errorRate: summary.calls
          ? rounded((summary.failures / summary.calls) * 100, 1)
          : 0,
        averageLatencyMs: summary.calls
          ? Math.round(summary.totalDurationMs / summary.calls)
          : 0,
      },
    ]),
  );
}

export function exposedProjectDeploymentVersion(deployment: {
  version: number;
  sourceProjectDeployment?: { version: number } | null;
}) {
  return deployment.sourceProjectDeployment?.version ?? deployment.version;
}
