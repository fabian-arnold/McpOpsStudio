"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarClock, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  CronBindingEditor,
  type EditableCronBinding,
} from "@/components/cron-binding-editor";
import {
  Badge,
  Button,
  EmptyState,
  LoadError,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/providers";
import { api, errorMessage } from "@/lib/api";
import type { EnvironmentSummary, OpsFunction } from "@/lib/types";

type Schedule = EditableCronBinding & {
  environment: EnvironmentSummary;
  function: OpsFunction;
  activation: "active" | "draft";
  scheduler: { status: "available" | "unavailable"; nextRunAt: number | null };
};
type Run = {
  id: string;
  scheduledAt: string;
  triggeredAt?: string;
  completedAt?: string;
  origin: "scheduled" | "manual";
  status: string;
  reason?: string;
  execution?: { id: string; status: string; durationMs: number };
};

export default function SchedulesPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <Skeleton className="h-72" />
        </AppShell>
      }
    >
      <SchedulesContent />
    </Suspense>
  );
}

// The page keeps filtering, mutation, and run-history state together so refreshes
// cannot render scheduler state from a different binding revision.
// eslint-disable-next-line max-lines-per-function
function SchedulesContent() {
  const params = useSearchParams();
  const toast = useToast();
  const [items, setItems] = useState<Schedule[]>();
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [functions, setFunctions] = useState<OpsFunction[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<"available" | "unavailable">(
    "unavailable",
  );
  const [loadError, setLoadError] = useState<string>();
  const [editing, setEditing] = useState<Schedule | "new" | undefined>(
    params.get("create") ? "new" : undefined,
  );
  const [environmentFilter, setEnvironmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [runs, setRuns] = useState<Record<string, Run[]>>({});
  const [busyId, setBusyId] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [scheduleResponse, environmentResponse, functionResponse] =
        await Promise.all([
          api<{ items: Schedule[]; schedulerStatus: "available" | "unavailable" }>(
            "/api/cron-bindings",
          ),
          api<EnvironmentSummary[]>("/api/environments"),
          api<OpsFunction[]>("/api/functions"),
        ]);
      setItems(scheduleResponse.items);
      setSchedulerStatus(scheduleResponse.schedulerStatus);
      setEnvironments(environmentResponse);
      setFunctions(functionResponse);
      setLoadError(undefined);
      const requested = params.get("bindingId");
      if (requested)
        setEditing(scheduleResponse.items.find((item) => item.id === requested));
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [params]);
  useEffect(() => void load(), [load]);

  const filtered = useMemo(
    () =>
      (items ?? []).filter(
        (item) =>
          (!environmentFilter || item.environmentId === environmentFilter) &&
          (!statusFilter ||
            (statusFilter === "enabled"
              ? item.enabled
              : statusFilter === "disabled"
                ? !item.enabled
                : item.activation === statusFilter)),
      ),
    [environmentFilter, items, statusFilter],
  );

  async function loadRuns(id: string) {
    try {
      const response = await api<{ items: Run[] }>(
        `/api/cron-bindings/${id}/runs?limit=20`,
      );
      setRuns((current) => ({ ...current, [id]: response.items }));
    } catch (error) {
      toast({
        title: "Runs unavailable",
        description: errorMessage(error),
        tone: "error",
      });
    }
  }
  async function mutate(id: string, action: "run" | "toggle" | "delete") {
    const binding = items?.find((item) => item.id === id);
    if (!binding) return;
    if (
      action === "run" &&
      !window.confirm(`Run '${binding.name}' now from the active immutable snapshot?`)
    )
      return;
    if (
      action === "delete" &&
      !window.confirm(`Delete '${binding.name}'? Historical runs will be retained.`)
    )
      return;
    setBusyId(id);
    try {
      if (action === "run")
        await api(`/api/cron-bindings/${id}/run`, { method: "POST", body: "{}" });
      else if (action === "toggle")
        await api(`/api/cron-bindings/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: !binding.enabled }),
        });
      else await api(`/api/cron-bindings/${id}`, { method: "DELETE" });
      toast({
        title:
          action === "run"
            ? "Run queued"
            : action === "delete"
              ? "Schedule deleted"
              : binding.enabled
                ? "Schedule disabled"
                : "Schedule enabled",
        description:
          action === "run"
            ? "Execution uses the currently active schedule artifact."
            : "Deploy the Project to update active schedulers.",
        tone: "success",
      });
      await load();
      if (action === "run") window.setTimeout(() => void loadRuns(id), 700);
    } catch (error) {
      toast({
        title: "Schedule operation failed",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <PageHeader
          title="Schedules"
          description="Environment-scoped cron bindings that invoke immutable Function snapshots on private workers."
          actions={
            <Button onClick={() => setEditing("new")}>
              <Plus size={14} /> New schedule
            </Button>
          }
        />
        {schedulerStatus === "unavailable" && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
            Redis scheduler inventory is unavailable. Draft data is shown, but next-run
            state cannot be verified.
          </div>
        )}
        {editing && (
          <CronBindingEditor
            {...(editing === "new" ? {} : { binding: editing })}
            environments={environments}
            functions={functions}
            {...(editing === "new" && params.get("functionId")
              ? { fixedFunctionId: params.get("functionId")! }
              : {})}
            onCancel={() => setEditing(undefined)}
            onSaved={async () => {
              setEditing(undefined);
              await load();
            }}
          />
        )}
        <div className="flex flex-wrap gap-2 rounded-xl border bg-card p-3">
          <select
            className="field h-9 w-52"
            value={environmentFilter}
            onChange={(event) => setEnvironmentFilter(event.target.value)}
          >
            <option value="">All environments</option>
            {environments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            className="field h-9 w-44"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All states</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
            <option value="active">Active snapshot</option>
            <option value="draft">Draft only</option>
          </select>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
        {loadError ? (
          <LoadError
            title="Unable to load schedules"
            message={loadError}
            onRetry={() => void load()}
          />
        ) : !items ? (
          <Skeleton className="h-72" />
        ) : !filtered.length ? (
          <EmptyState
            icon={<CalendarClock />}
            title="No schedules"
            description="Create a cron binding to invoke a Function at minute-level precision."
          />
        ) : (
          <div className="space-y-3">
            {filtered.map((item) => (
              <section key={item.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold">{item.name}</h2>
                      <Badge tone={item.enabled ? "success" : "neutral"}>
                        {item.enabled ? "enabled" : "disabled"}
                      </Badge>
                      <Badge
                        tone={item.activation === "active" ? "primary" : "warning"}
                      >
                        {item.activation}
                      </Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {item.expression} · {item.timezone}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.environment.name} → {item.function.name} · service{" "}
                      {item.serviceSubject}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Next run:{" "}
                      {item.scheduler.status === "unavailable"
                        ? "unavailable"
                        : item.scheduler.nextRunAt
                          ? new Date(item.scheduler.nextRunAt).toLocaleString()
                          : "not scheduled"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setEditing(item)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busyId === item.id}
                      onClick={() => void mutate(item.id, "toggle")}
                    >
                      {item.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      size="sm"
                      loading={busyId === item.id}
                      disabled={item.activation !== "active"}
                      onClick={() => void mutate(item.id, "run")}
                    >
                      <Play size={12} /> Run now
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete schedule"
                      onClick={() => void mutate(item.id, "delete")}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 border-t pt-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void loadRuns(item.id)}
                  >
                    Recent runs
                  </Button>
                  {runs[item.id] && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="py-2">Scheduled</th>
                            <th>Status</th>
                            <th>Origin</th>
                            <th>Duration</th>
                            <th>Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {runs[item.id]?.map((run) => (
                            <tr key={run.id} className="border-t">
                              <td className="py-2">
                                {new Date(run.scheduledAt).toLocaleString()}
                              </td>
                              <td>{run.status}</td>
                              <td>{run.origin}</td>
                              <td>
                                {run.execution ? `${run.execution.durationMs} ms` : "—"}
                              </td>
                              <td>{run.reason ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
