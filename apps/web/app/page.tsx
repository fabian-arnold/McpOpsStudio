"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Boxes,
  Clock3,
  Code2,
  Gauge,
  ServerCog,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  Button,
  EmptyState,
  LoadError,
  PageHeader,
  Skeleton,
  StatusDot,
  UnavailableValue,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { Dashboard } from "@/lib/types";
import { EndpointCreateDialog } from "@/components/endpoint-create-dialog";
import { EnvironmentEndpointUrls } from "@/components/environment-endpoint-urls";

const fmt = new Intl.NumberFormat("en", { notation: "compact" });
function timeAgo(value: string) {
  const mins = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  return mins < 60 ? `${Math.max(1, mins)}m ago` : `${Math.floor(mins / 60)}h ago`;
}
function comparison(value: number | undefined, suffix = "%") {
  if (value === undefined) return undefined;
  const text = `${value > 0 ? "+" : ""}${value}${suffix}`;
  return { text, positive: value > 0 };
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => {
    setData(undefined);
    setError(undefined);
    api<Dashboard>("/api/dashboard")
      .then(setData)
      .catch((reason) => setError(errorMessage(reason)));
  }, []);
  useEffect(load, [attempt, load]);
  if (error)
    return (
      <AppShell>
        <PageHeader
          eyebrow="Control plane"
          title="Operations overview"
          description="Monitor deployed functions and recent platform activity."
        />
        <LoadError message={error} onRetry={() => setAttempt((value) => value + 1)} />
      </AppShell>
    );
  if (!data)
    return (
      <AppShell>
        <DashboardSkeleton />
      </AppShell>
    );
  const stats = [
    {
      label: "Runtime endpoints",
      value: data.stats.endpoints,
      note: "Deployed MCP Endpoints and HTTP APIs",
      icon: ServerCog,
      tone: "text-violet-500",
      trend: undefined,
    },
    {
      label: "Function calls",
      value: fmt.format(data.stats.calls24h),
      note: "Last 24 hours",
      icon: Activity,
      tone: "text-sky-500",
      trend: comparison(data.comparisons?.calls?.changePercent ?? undefined),
    },
    {
      label: "Error rate",
      value: `${data.stats.errorRate}%`,
      note:
        data.stats.failedCalls24h === undefined
          ? undefined
          : `${data.stats.failedCalls24h} failed calls`,
      icon: ShieldAlert,
      tone: "text-red-500",
      trend: comparison(data.comparisons?.errorRate?.changePercent ?? undefined),
    },
    {
      label: "Average latency",
      value: `${data.stats.averageLatencyMs}ms`,
      note:
        data.stats.p95LatencyMs === undefined
          ? undefined
          : `p95 · ${data.stats.p95LatencyMs}ms`,
      icon: Gauge,
      tone: "text-emerald-500",
      trend: comparison(data.comparisons?.averageLatencyMs?.changePercent ?? undefined),
    },
  ];
  const deployment = data.activeDeployments?.[0];
  const buckets = data.trafficBuckets ?? [];
  const maxBucket = Math.max(1, ...buckets.map((bucket) => bucket.calls));
  const context = data.context?.generatedAt
    ? `Authenticated project · updated ${new Date(data.context.generatedAt).toLocaleTimeString()}`
    : "Authenticated project";
  return (
    <AppShell>
      <PageHeader
        eyebrow={context}
        title="Operations overview"
        description="Monitor your deployed functions, runtime health, and recent platform activity."
        actions={
          <>
            <EndpointCreateDialog
              kind="mcp"
              variant="secondary"
              onCreated={(endpoint) => router.push(`/endpoints/${endpoint.id}`)}
            />
            <Link href="/functions">
              <Button>
                <Code2 size={15} />
                New function
              </Button>
            </Link>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="panel p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {stat.label}
              </span>
              <span className="rounded-lg bg-muted p-2">
                <stat.icon size={16} className={stat.tone} />
              </span>
            </div>
            <div className="mt-4 flex items-end gap-2">
              <strong className="text-2xl font-semibold tracking-tight">
                {stat.value}
              </strong>
              {stat.trend && (
                <span
                  className={
                    stat.trend.positive
                      ? "mb-0.5 flex items-center text-[10px] font-medium text-emerald-500"
                      : "mb-0.5 flex items-center text-[10px] font-medium text-muted-foreground"
                  }
                >
                  {stat.trend.positive ? (
                    <TrendingUp size={11} />
                  ) : (
                    <TrendingDown size={11} />
                  )}
                  {stat.trend.text}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {stat.note ?? <UnavailableValue />}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">Runtime traffic</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                API-reported invocation buckets for the last 24 hours
              </p>
            </div>
            {data.health ? (
              <Badge tone={data.health.status === "healthy" ? "success" : "warning"}>
                <StatusDot status={data.health.status} />
                {data.health.status}
              </Badge>
            ) : (
              <Badge>
                <UnavailableValue label="Health unavailable" />
              </Badge>
            )}
          </div>
          {buckets.length ? (
            <div className="p-5">
              <div className="flex h-48 items-end gap-1.5">
                {buckets.map((bucket) => (
                  <div
                    key={bucket.startedAt}
                    title={`${new Date(bucket.startedAt).toLocaleString()}: ${bucket.calls} calls, ${bucket.failures} failures`}
                    className="group relative flex-1 rounded-t bg-primary/15 transition hover:bg-primary/35"
                    style={{
                      height: `${Math.max(3, (bucket.calls / maxBucket) * 100)}%`,
                    }}
                  >
                    <span className="absolute -top-7 left-1/2 hidden -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 text-[9px] text-background group-hover:block">
                      {bucket.calls}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-between text-[10px] text-muted-foreground">
                <span>
                  {new Date(buckets[0]!.startedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span>
                  {new Date(buckets[buckets.length - 1]!.startedAt).toLocaleTimeString(
                    [],
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )}
                </span>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<Activity />}
              title="Traffic buckets unavailable"
              description="No time-bucketed traffic series was returned by the control-plane API."
            />
          )}
        </section>
        <section className="panel overflow-hidden">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">Active deployment</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Latest active immutable snapshot
            </p>
          </div>
          {deployment ? (
            <div className="p-5">
              <div className="flex items-center justify-between">
                <Badge tone="success">
                  <StatusDot status="active" />
                  Version {deployment.version}
                </Badge>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {deployment.checksum.slice(0, 12)}
                </span>
              </div>
              <h3 className="mt-5 text-sm font-semibold">{deployment.endpoint.name}</h3>
              <div className="my-4 space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Deployed</span>
                  <span className="font-medium">
                    {deployment.completedAt ? (
                      timeAgo(deployment.completedAt)
                    ) : (
                      <UnavailableValue />
                    )}
                  </span>
                </div>
                <EnvironmentEndpointUrls
                  kind={deployment.endpoint.kind}
                  urls={deployment.environmentEndpoints}
                  fallback={deployment.endpoints}
                />
              </div>
              <Link
                href="/deployments"
                className="flex items-center text-xs font-medium text-primary hover:underline"
              >
                View deployment <ArrowRight size={13} className="ml-1" />
              </Link>
            </div>
          ) : (
            <EmptyState
              icon={<Boxes />}
              title="No active deployment"
              description="No active deployment snapshot was returned for this project."
            />
          )}
        </section>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">Recent executions</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Latest calls across MCP and HTTP
              </p>
            </div>
            <Link
              href="/executions"
              className="text-xs font-medium text-primary hover:underline"
            >
              View all
            </Link>
          </div>
          {data.recentExecutions.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead>
                  <tr className="border-b bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-5 py-2.5">Function</th>
                    <th className="px-3 py-2.5">Source</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Latency</th>
                    <th className="px-5 py-2.5 text-right">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentExecutions.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-5 py-3">
                        <p className="font-mono text-xs font-medium">
                          {item.functionName}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          {item.requestId}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge
                          tone={item.invocationSource === "mcp" ? "primary" : "info"}
                        >
                          {item.invocationSource.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-2 text-xs capitalize">
                          <StatusDot status={item.status} />
                          {item.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {item.durationMs} ms
                      </td>
                      <td className="px-5 py-3 text-right text-[11px] text-muted-foreground">
                        {timeAgo(item.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<Activity />}
              title="No executions yet"
              description="Calls will appear here after a deployed function is invoked."
            />
          )}
        </section>
        <section className="panel overflow-hidden">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">Audit activity</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Security and configuration changes
            </p>
          </div>
          {data.auditEvents.length ? (
            <div className="divide-y px-5">
              {data.auditEvents.map((event) => (
                <div className="flex gap-3 py-3.5" key={event.id}>
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted">
                    <Clock3 size={13} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">
                      {event.action.replaceAll(".", " ")}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {event.actor}
                      {event.targetId ? ` · ${event.targetId}` : ""}
                    </p>
                  </div>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {timeAgo(event.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Clock3 />}
              title="No audit activity"
              description="Audited control-plane and runtime actions will appear here."
            />
          )}
        </section>
      </div>
    </AppShell>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <Skeleton className="h-7 w-72" />
      <Skeleton className="mt-3 h-4 w-96" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((n) => (
          <Skeleton className="h-32" key={n} />
        ))}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </>
  );
}
