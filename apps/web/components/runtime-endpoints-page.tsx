"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Power, Search, ServerCog, TerminalSquare } from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  LoadError,
  Dialog,
  StatusDot,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { EnvironmentSummary, RuntimeEndpoint } from "@/lib/types";
import { useToast } from "@/components/providers";
import { EndpointCreateDialog } from "@/components/endpoint-create-dialog";
import { roleAllows, useCurrentUser } from "@/lib/session";
import { EnvironmentEndpointUrls } from "@/components/environment-endpoint-urls";

export function RuntimeEndpointsPage({ kind }: { kind?: "mcp" | "http" }) {
  const label =
    kind === "mcp" ? "MCP Endpoints" : kind === "http" ? "HTTP APIs" : "Endpoints";
  const singular =
    kind === "mcp" ? "MCP Endpoint" : kind === "http" ? "HTTP API" : "endpoint";
  const basePath = "/endpoints";
  const [endpoints, setEndpoints] = useState<RuntimeEndpoint[]>();
  const [loadError, setLoadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [kindFilter, setKindFilter] = useState<"" | "mcp" | "http">(kind ?? "");
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const user = useCurrentUser();
  const load = useCallback(() => {
    setEndpoints(undefined);
    setLoadError(undefined);
    api<RuntimeEndpoint[]>(
      `/api/runtime-endpoints?${kindFilter ? `kind=${kindFilter}&` : ""}${environmentId ? `environmentId=${encodeURIComponent(environmentId)}` : ""}`,
    )
      .then(setEndpoints)
      .catch((error) => setLoadError(errorMessage(error)));
  }, [environmentId, kindFilter]);
  useEffect(load, [attempt, load]);
  useEffect(() => {
    api<EnvironmentSummary[]>("/api/environments")
      .then(setEnvironments)
      .catch(() => setEnvironments([]));
  }, []);
  const filtered = useMemo(
    () =>
      endpoints?.filter((endpoint) =>
        `${endpoint.name} ${endpoint.description}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [query, endpoints],
  );
  return (
    <AppShell>
      <PageHeader
        eyebrow="Runtime"
        title={label}
        description={
          kind === "mcp"
            ? "Assign project Functions as tools; Project deployments version every MCP endpoint together."
            : kind === "http"
              ? "Assign project Functions to routes; Project deployments version every HTTP API together."
              : "Define MCP Endpoints and HTTP APIs, bind project Functions, and retrieve client metadata from one place."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {kind !== "http" && (
              <EndpointCreateDialog
                kind="mcp"
                onCreated={() => setAttempt((value) => value + 1)}
              />
            )}
            {kind !== "mcp" && (
              <EndpointCreateDialog
                kind="http"
                variant={kind ? "primary" : "secondary"}
                onCreated={() => setAttempt((value) => value + 1)}
              />
            )}
          </div>
        }
      />
      {loadError ? (
        <LoadError
          title={`Unable to load ${label}`}
          message={loadError}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1 sm:max-w-sm">
              <Search
                size={15}
                className="absolute left-3 top-2.5 text-muted-foreground"
              />
              <input
                className="field h-9 pl-9"
                placeholder={`Search ${label.toLowerCase()}…`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {!kind && (
              <>
                <label className="sr-only" htmlFor="endpoint-kind-filter">
                  Filter by endpoint kind
                </label>
                <select
                  id="endpoint-kind-filter"
                  className="field h-9 w-full py-1 text-xs sm:w-40"
                  value={kindFilter}
                  onChange={(event) =>
                    setKindFilter(event.target.value as "" | "mcp" | "http")
                  }
                >
                  <option value="">All endpoint types</option>
                  <option value="mcp">MCP Endpoints</option>
                  <option value="http">HTTP APIs</option>
                </select>
              </>
            )}
            <label className="sr-only" htmlFor="environment-filter">
              Filter by environment
            </label>
            <select
              id="environment-filter"
              className="field h-9 w-full py-1 text-xs sm:w-48"
              value={environmentId}
              onChange={(event) => setEnvironmentId(event.target.value)}
            >
              <option value="">All environments</option>
              {environments.map((environment) => (
                <option value={environment.id} key={environment.id}>
                  {environment.name}
                </option>
              ))}
            </select>
          </div>
          {!endpoints ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {[1, 2].map((n) => (
                <Skeleton className="h-64" key={n} />
              ))}
            </div>
          ) : filtered?.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {filtered.map((endpoint) => {
                const endpointKind = endpoint.kind;
                const EndpointIcon =
                  endpointKind === "mcp" ? TerminalSquare : ServerCog;
                const endpointLabel =
                  endpointKind === "mcp" ? "MCP Endpoint" : "HTTP API";
                return (
                  <article
                    key={endpoint.id}
                    className="panel group overflow-hidden transition hover:border-primary/30"
                  >
                    <div className="p-5">
                      <div className="flex items-start gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                          <EndpointIcon size={19} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`${basePath}/${endpoint.id}`}
                              className="truncate text-sm font-semibold hover:text-primary"
                            >
                              {endpoint.name}
                            </Link>
                            <Badge
                              tone={
                                endpoint.status === "deployed"
                                  ? "success"
                                  : endpoint.status === "failed"
                                    ? "danger"
                                    : "neutral"
                              }
                            >
                              <StatusDot status={endpoint.status} />
                              {endpoint.status}
                            </Badge>
                            <Badge>{endpointKind === "mcp" ? "MCP" : "HTTP"}</Badge>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                            {endpoint.description}
                          </p>
                        </div>
                        <DisableEndpointAction
                          endpoint={endpoint}
                          canDisable={roleAllows(user?.role, [
                            "owner",
                            "admin",
                            "operator",
                          ])}
                          onDisabled={() => setAttempt((value) => value + 1)}
                        />
                      </div>
                      <div className="mt-5 grid grid-cols-2 divide-x rounded-lg border bg-muted/20 py-3 text-center">
                        <div>
                          <strong className="block text-sm">
                            {endpoint.functionCount}
                          </strong>
                          <span className="text-[10px] text-muted-foreground">
                            Functions
                          </span>
                        </div>
                        <div>
                          <strong className="block text-sm">
                            {endpointKind === "mcp"
                              ? endpoint.mcpToolCount
                              : endpoint.httpRouteCount}
                          </strong>
                          <span className="text-[10px] text-muted-foreground">
                            {endpointKind === "mcp" ? "MCP tools" : "HTTP routes"}
                          </span>
                        </div>
                      </div>
                      <div className="mt-4 space-y-2">
                        <EnvironmentEndpointUrls
                          kind={endpointKind}
                          urls={endpoint.environmentEndpoints}
                          fallback={endpoint.endpoints}
                        />
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">
                            {endpoint.environment.name} · {endpoint.authMode}
                          </span>
                          <span>
                            {endpoint.activeDeployment
                              ? `v${endpoint.activeDeployment.version} · ${new Date(endpoint.updatedAt).toLocaleDateString()}`
                              : "Not deployed"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Link
                      href={`${basePath}/${endpoint.id}`}
                      className="flex items-center justify-between border-t bg-muted/15 px-5 py-3 text-xs font-medium text-muted-foreground transition group-hover:text-primary"
                    >
                      Open {endpointLabel} <ArrowRight size={14} />
                    </Link>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<ServerCog />}
              title={`No ${label.toLowerCase()} found`}
              description={
                query
                  ? "Try a different search term."
                  : `Create an ${singular} and assign project Functions.`
              }
              action={
                !query && (
                  <div className="flex flex-wrap justify-center gap-2">
                    {kind !== "http" && (
                      <EndpointCreateDialog
                        kind="mcp"
                        onCreated={() => setAttempt((value) => value + 1)}
                      />
                    )}
                    {kind !== "mcp" && (
                      <EndpointCreateDialog
                        kind="http"
                        variant={kind ? "primary" : "secondary"}
                        onCreated={() => setAttempt((value) => value + 1)}
                      />
                    )}
                  </div>
                )
              }
            />
          )}
        </>
      )}
    </AppShell>
  );
}

function DisableEndpointAction({
  endpoint,
  onDisabled,
  canDisable,
}: {
  endpoint: RuntimeEndpoint;
  onDisabled: () => void;
  canDisable: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  if (endpoint.status === "disabled") return <Badge>Disabled</Badge>;
  async function disable() {
    setBusy(true);
    setMutationError(undefined);
    try {
      await api(`/api/runtime-endpoints/${endpoint.id}/disable`, {
        method: "POST",
        body: "{}",
      });
      toast({
        title: "RuntimeEndpoint disabled",
        description: `${endpoint.name} endpoints are no longer active.`,
        tone: "success",
      });
      setOpen(false);
      onDisabled();
    } catch (error) {
      setMutationError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          variant="ghost"
          size="icon"
          disabled={!canDisable}
          aria-label={`Disable ${endpoint.name}`}
          title={
            canDisable
              ? `Disable ${endpoint.name}`
              : "Your role cannot disable endpoints"
          }
        >
          <Power size={15} />
        </Button>
      }
      title={`Disable ${endpoint.name}?`}
      description="Runtime endpoints will stop serving traffic. Deployment and audit history are retained."
    >
      {mutationError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400"
        >
          {mutationError}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button variant="danger" loading={busy} onClick={disable}>
          Disable endpoint
        </Button>
      </div>
    </Dialog>
  );
}
