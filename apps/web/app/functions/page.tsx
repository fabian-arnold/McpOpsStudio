"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Code2, Plus, Search, ServerCog } from "lucide-react";
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
import { roleAllows, useCurrentUser } from "@/lib/session";
import type { OpsFunction } from "@/lib/types";

const editorLink =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition hover:brightness-110";

export default function ProjectFunctionsPage() {
  const [functions, setFunctions] = useState<OpsFunction[]>();
  const [loadError, setLoadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const user = useCurrentUser();
  const canManage = roleAllows(user?.role, ["owner", "admin", "developer"]);
  const load = useCallback(() => {
    setFunctions(undefined);
    setLoadError(undefined);
    api<OpsFunction[]>("/api/functions")
      .then(setFunctions)
      .catch((error) => setLoadError(errorMessage(error)));
  }, []);
  useEffect(load, [attempt, load]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return functions;
    return functions?.filter((fn) =>
      `${fn.name} ${fn.slug} ${fn.description}`.toLowerCase().includes(needle),
    );
  }, [functions, query]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Project"
        title="Functions"
        description={`Reusable TypeScript capabilities available to every endpoint in ${user?.project.name ?? "the selected project"}.`}
        actions={
          canManage ? (
            <Link href="/functions/new" className={editorLink}>
              <Plus size={14} /> New function
            </Link>
          ) : undefined
        }
      />
      {loadError ? (
        <LoadError
          title="Unable to load project functions"
          message={loadError}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : !functions ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <div className="relative mb-5 max-w-md">
            <Search
              size={15}
              className="absolute left-3 top-2.5 text-muted-foreground"
            />
            <input
              className="field h-9 pl-9"
              placeholder="Search project functions…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {filtered?.length ? (
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="hidden grid-cols-[minmax(260px,1.6fr)_100px_90px_minmax(220px,1fr)_110px] gap-4 border-b bg-muted/30 px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
                <span>Function</span>
                <span>Risk</span>
                <span>Version</span>
                <span>Used by endpoints</span>
                <span />
              </div>
              {filtered.map((fn) => {
                const usages = fn.usages ?? [];
                const stale = usages.some(
                  (usage) =>
                    usage.stale ||
                    (usage.deployedVersion != null &&
                      usage.deployedVersion < fn.version),
                );
                return (
                  <div
                    key={fn.id}
                    className="grid gap-4 border-b px-5 py-4 last:border-b-0 md:grid-cols-[minmax(260px,1.6fr)_100px_90px_minmax(220px,1fr)_110px] md:items-center"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Code2 size={16} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="truncate text-xs font-semibold">
                            {fn.name}
                          </code>
                          <StatusDot
                            status={fn.enabled ? "active" : "disabled"}
                          />
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {fn.description || "No description provided."}
                        </p>
                      </div>
                    </div>
                    <Badge
                      className="w-fit"
                      tone={
                        fn.riskLevel === "read"
                          ? "neutral"
                          : fn.riskLevel === "write"
                            ? "warning"
                            : "danger"
                      }
                    >
                      {fn.riskLevel}
                    </Badge>
                    <span className="text-xs">v{fn.version}</span>
                    <div className="min-w-0">
                      {usages.length ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {usages.slice(0, 3).map((usage) => (
                            <Link
                              key={usage.endpointId}
                              href={`${usage.endpointKind === "mcp" ? "/mcp-endpoints" : "/http-apis"}/${usage.endpointId}?tab=bindings`}
                              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted"
                            >
                              <ServerCog size={11} /> {usage.endpointName}
                            </Link>
                          ))}
                          {usages.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{usages.length - 3} more
                            </span>
                          )}
                          {stale && <Badge tone="warning">Deploy needed</Badge>}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Not exposed by an endpoint
                        </span>
                      )}
                    </div>
                    <Link
                      href={`/functions/${fn.id}`}
                      className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border bg-card px-3 text-xs font-medium hover:bg-muted"
                    >
                      Open editor <ArrowRight size={13} />
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<Code2 />}
              title={query ? "No matching functions" : "No project functions"}
              description={
                query
                  ? "Try another name or description."
                  : "Create a reusable TypeScript Function, then expose it from MCP Endpoints or HTTP APIs."
              }
              action={
                !query && canManage ? (
                  <Link href="/functions/new" className={editorLink}>
                    <Plus size={14} /> New function
                  </Link>
                ) : undefined
              }
            />
          )}
        </>
      )}
      <div className="mt-5 rounded-xl border p-4 text-xs text-muted-foreground">
        <strong className="text-foreground">Code-first reuse.</strong> MCP Endpoints
        and HTTP APIs only bind and deploy Functions. Function composition belongs in
        TypeScript through reviewed runtime capabilities, never in a workflow
        graph.
      </div>
    </AppShell>
  );
}
