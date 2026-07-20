"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  LoadError,
  PageHeader,
  Skeleton,
  StatusDot,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { Execution } from "@/lib/types";
import { downloadText } from "@/lib/download";

export default function ExecutionsPage() {
  const [items, setItems] = useState<Execution[]>();
  const [loadError, setLoadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [requestId, setRequestId] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const load = useCallback(
    (silent = false) => {
      if (!silent) setItems(undefined);
      setLoadError(undefined);
      const params = new URLSearchParams({ limit: "500" });
      if (requestId) params.set("requestId", requestId);
      if (status) params.set("status", status);
      if (source) params.set("source", source);
      api<{ items: Execution[]; nextCursor?: string }>(`/api/executions?${params}`)
        .then((result) => {
          setItems(result.items);
          if (!silent) setPage(0);
        })
        .catch((error) => setLoadError(errorMessage(error)));
    },
    [requestId, source, status],
  );
  useEffect(() => load(), [attempt, load]);
  useEffect(() => {
    const timer = window.setInterval(() => load(true), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);
  const visible = useMemo(
    () => items?.slice(page * pageSize, (page + 1) * pageSize),
    [items, page],
  );
  return (
    <AppShell>
      <PageHeader
        eyebrow="Observability"
        title="Executions"
        description="Inspect persisted calls, authorization outcomes, latency, safe errors, and deployment versions."
        actions={
          <Button
            variant="secondary"
            disabled={!items?.length}
            onClick={() =>
              items &&
              downloadText(
                "executions.json",
                JSON.stringify(items, null, 2),
                "application/json",
              )
            }
          >
            <Download size={14} />
            Export masked JSON
          </Button>
        }
      />
      {loadError ? (
        <LoadError
          title="Unable to load executions"
          message={loadError}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : (
        <>
          <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-2.5 text-muted-foreground"
              />
              <input
                className="field h-9 pl-9 text-xs"
                placeholder="Exact request ID"
                value={requestId}
                onChange={(event) => setRequestId(event.target.value)}
              />
            </div>
            <select
              className="field h-9 py-1 text-xs"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {[
                "running",
                "success",
                "error",
                "denied",
                "timeout",
                "validation_error",
              ].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select
              className="field h-9 py-1 text-xs"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="">All sources</option>
              {["mcp", "http", "cron", "test", "internal"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => load()}>
              Refresh
            </Button>
          </div>
          {!items ? (
            <Skeleton className="h-96" />
          ) : visible?.length ? (
            <>
              <div className="panel overflow-x-auto">
                <table className="w-full min-w-[950px] text-left">
                  <thead>
                    <tr className="border-b bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {[
                        "Timestamp",
                        "Function / binding",
                        "Request",
                        "Caller",
                        "Source",
                        "Status",
                        "Latency",
                        "Versions",
                        "Detail",
                      ].map((label) => (
                        <th className="px-4 py-3 font-medium" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => (
                      <tr
                        className="border-b last:border-0 hover:bg-muted/25"
                        key={item.id}
                      >
                        <td className="px-4 py-3 text-[10px] text-muted-foreground">
                          {new Date(item.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          {item.endpointId && item.functionId ? (
                            <Link
                              className="font-mono text-[11px] font-medium hover:text-primary"
                              href={`/functions/${item.functionId}`}
                            >
                              {item.functionName}
                            </Link>
                          ) : (
                            <span className="font-mono text-[11px]">
                              {item.functionName}
                            </span>
                          )}
                          <p className="text-[9px] text-muted-foreground">
                            {item.binding}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-mono text-[10px]">
                          {item.requestId}
                        </td>
                        <td className="px-4 py-3 text-[10px]">{item.caller ?? "—"}</td>
                        <td className="px-4 py-3">
                          <Badge
                            tone={item.invocationSource === "mcp" ? "primary" : "info"}
                          >
                            {item.invocationSource}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2 text-xs capitalize">
                            <StatusDot status={item.status} />
                            {item.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">{item.durationMs} ms</td>
                        <td className="px-4 py-3 text-xs">
                          <span className="block">
                            Function v{item.functionVersion}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            Environment v{item.deploymentVersion}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <ExecutionDetail execution={item} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {page + 1} of {Math.ceil(items.length / pageSize)}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={(page + 1) * pageSize >= items.length}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Search />}
              title="No matching executions"
              description="No persisted executions match the current project-scoped filters."
            />
          )}
        </>
      )}
    </AppShell>
  );
}

function ExecutionDetail({ execution }: { execution: Execution }) {
  const [detail, setDetail] = useState<unknown>();
  const [loadError, setLoadError] = useState<string>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let controller: AbortController | undefined;
    const loadDetail = () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      void api(`/api/executions/${execution.id}`, { signal: requestController.signal })
        .then(setDetail)
        .catch((error) => {
          if (!requestController.signal.aborted) setLoadError(errorMessage(error));
        });
    };
    loadDetail();
    const timer =
      execution.status === "running"
        ? window.setInterval(loadDetail, 5_000)
        : undefined;
    return () => {
      if (timer) window.clearInterval(timer);
      controller?.abort();
    };
  }, [execution.id, execution.status, open]);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm">
          Open
        </Button>
      }
      title={`Execution ${execution.requestId}`}
      description="Masked persisted execution detail."
    >
      {loadError ? (
        <div className="text-xs text-red-500">{loadError}</div>
      ) : detail ? (
        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-[#0b0d14] p-4 font-mono text-[10px] leading-5 text-slate-300">
          {JSON.stringify(detail, null, 2)}
        </pre>
      ) : (
        <Skeleton className="h-64" />
      )}
    </Dialog>
  );
}
