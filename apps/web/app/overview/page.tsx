"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Boxes,
  Code2,
  FolderKanban,
  Search,
  ShieldAlert,
} from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  EmptyState,
  LoadError,
  PageHeader,
  Skeleton,
  StatusDot,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { GlobalOverview } from "@/lib/types";

const compact = new Intl.NumberFormat("en", { notation: "compact" });

function healthTone(health: GlobalOverview["projects"][number]["health"]) {
  if (health === "healthy") return "success" as const;
  if (health === "degraded") return "warning" as const;
  return "neutral" as const;
}

export default function GlobalOverviewPage() {
  const [data, setData] = useState<GlobalOverview>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const load = useCallback(() => {
    setError(undefined);
    api<GlobalOverview>("/api/global-overview")
      .then(setData)
      .catch((reason) => setError(errorMessage(reason)));
  }, []);
  useEffect(load, [load]);
  const projects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return data?.projects ?? [];
    return (data?.projects ?? []).filter((project) =>
      [project.name, project.slug, project.description].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
  }, [data, query]);

  if (error)
    return (
      <AppShell>
        <PageHeader
          eyebrow="Installation"
          title="Global overview"
          description="Cross-project runtime health, traffic, and deployment versions."
        />
        <LoadError
          title="Unable to load the global overview"
          message={error}
          onRetry={load}
        />
      </AppShell>
    );
  if (!data)
    return (
      <AppShell>
        <OverviewSkeleton />
      </AppShell>
    );

  const stats = [
    {
      label: "Projects",
      value: data.stats.projects,
      note: `${data.stats.activeProjects} active`,
      icon: FolderKanban,
      tone: "text-violet-500",
    },
    {
      label: "Runtime endpoints",
      value: data.stats.endpoints,
      note: `${data.stats.functions} reusable functions`,
      icon: Boxes,
      tone: "text-sky-500",
    },
    {
      label: "Function calls",
      value: compact.format(data.stats.calls24h),
      note: `${data.stats.failedCalls24h} failed in 24h`,
      icon: Activity,
      tone: "text-emerald-500",
    },
    {
      label: "Global error rate",
      value: `${data.stats.errorRate}%`,
      note: `${data.stats.degradedProjects} degraded projects`,
      icon: ShieldAlert,
      tone: "text-red-500",
    },
  ];

  return (
    <AppShell>
      <PageHeader
        eyebrow={`Installation · updated ${new Date(data.generatedAt).toLocaleTimeString()}`}
        title="Global overview"
        description="Monitor every project from one read-only view. Metrics cover the last 24 hours; versions come from immutable active deployment snapshots."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div className="panel p-5" key={stat.label}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {stat.label}
              </span>
              <span className="rounded-lg bg-muted p-2">
                <stat.icon className={stat.tone} size={16} />
              </span>
            </div>
            <strong className="mt-4 block text-2xl font-semibold tracking-tight">
              {stat.value}
            </strong>
            <p className="mt-1 text-[11px] text-muted-foreground">{stat.note}</p>
          </div>
        ))}
      </div>

      <section className="panel mt-5 overflow-hidden">
        <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Projects</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Endpoint posture, traffic health, latency, and active versions
            </p>
          </div>
          <label className="relative block sm:w-72">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={14}
            />
            <input
              aria-label="Filter projects"
              className="field h-9 pl-9 text-xs"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter projects…"
              value={query}
            />
          </label>
        </div>
        {projects.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left">
              <thead>
                <tr className="border-b bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-2.5">Project</th>
                  <th className="px-3 py-2.5">Health</th>
                  <th className="px-3 py-2.5">Endpoints</th>
                  <th className="px-3 py-2.5">Calls / errors</th>
                  <th className="px-3 py-2.5">Latency</th>
                  <th className="px-3 py-2.5">Active versions</th>
                  <th className="px-5 py-2.5 text-right">Details</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr
                    className="border-b align-top last:border-0 hover:bg-muted/30"
                    key={project.id}
                  >
                    <td className="px-5 py-4">
                      <p className="text-xs font-semibold">{project.name}</p>
                      <code className="mt-0.5 block text-[10px] text-muted-foreground">
                        {project.slug}
                      </code>
                      <p className="mt-2 max-w-64 truncate text-[11px] text-muted-foreground">
                        {project.functions} functions
                        {project.description ? ` · ${project.description}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-4">
                      <Badge tone={healthTone(project.health)}>
                        <StatusDot status={project.health} />
                        {project.health}
                      </Badge>
                      {project.endpoints.failed > 0 && (
                        <p className="mt-2 text-[10px] text-red-500">
                          {project.endpoints.failed} failed endpoint
                          {project.endpoints.failed === 1 ? "" : "s"}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-4 text-xs">
                      <p className="font-medium">{project.endpoints.total} total</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {project.endpoints.mcp} MCP · {project.endpoints.http} HTTP
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {project.endpoints.activeSnapshots} active snapshots
                      </p>
                    </td>
                    <td className="px-3 py-4 text-xs">
                      <p className="font-medium">
                        {compact.format(project.execution.calls24h)} calls
                      </p>
                      <p
                        className={`mt-1 text-[10px] ${project.execution.errorRate > 0 ? "text-red-500" : "text-muted-foreground"}`}
                      >
                        {project.execution.errorRate}% error rate ·{" "}
                        {project.execution.failedCalls24h} failed
                      </p>
                    </td>
                    <td className="px-3 py-4 text-xs">
                      <p className="font-medium">
                        {project.execution.averageLatencyMs} ms
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        average · 24h
                      </p>
                    </td>
                    <td className="px-3 py-4">
                      <div className="space-y-1.5">
                        {project.environments.map((environment) => (
                          <div
                            className="flex items-center gap-2 text-[10px]"
                            key={environment.id}
                          >
                            <span className="w-20 truncate text-muted-foreground">
                              {environment.name}
                            </span>
                            {environment.activeDeployment ? (
                              <Badge tone="primary">
                                v{environment.activeDeployment.version}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </div>
                        ))}
                      </div>
                      {project.latestDeployment && (
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          Latest: {project.latestDeployment.status} v
                          {project.latestDeployment.version}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        href={`/projects/${project.id}`}
                      >
                        Open <ArrowRight size={12} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={query ? <Search /> : <Code2 />}
            title={query ? "No matching projects" : "No projects"}
            description={
              query
                ? "Try a different project name, slug, or description."
                : "Create a project to start tracking installation-wide operations."
            }
          />
        )}
      </section>
    </AppShell>
  );
}

function OverviewSkeleton() {
  return (
    <>
      <Skeleton className="h-7 w-64" />
      <Skeleton className="mt-3 h-4 w-96" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton className="h-32" key={item} />
        ))}
      </div>
      <Skeleton className="mt-5 h-96" />
    </>
  );
}
