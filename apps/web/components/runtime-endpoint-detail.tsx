"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Badge, LoadError, PageHeader, Skeleton, StatusDot } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { RuntimeEndpointDetail } from "@/lib/types";

import { Authentication } from "./runtime-endpoint-authentication";
import {
  NetworkPolicy,
  Executions,
  Manifest,
  Settings,
} from "./runtime-endpoint-operations";
import { Bindings, Overview } from "./runtime-endpoint-overview";
import { tabs, type EndpointKind, type Tab } from "./runtime-endpoint-types";

export function RuntimeEndpointDetailPage({ kind }: { kind: EndpointKind }) {
  const { endpointId } = useParams<{ endpointId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const [endpoint, setEndpoint] = useState<RuntimeEndpointDetail>();
  const [error, setError] = useState<string>();
  const tab = (
    tabs.some((item) => item.id === search.get("tab")) ? search.get("tab") : "overview"
  ) as Tab;
  const basePath = kind === "mcp" ? "/mcp-endpoints" : "/http-apis";
  const label = kind === "mcp" ? "MCP Endpoint" : "HTTP API";

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const value = await api<RuntimeEndpointDetail>(
        `/api/runtime-endpoints/${endpointId}`,
      );
      if (value.kind !== kind) throw new Error(`This endpoint is not an ${label}.`);
      setEndpoint(value);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [endpointId, kind, label]);
  useEffect(() => void load(), [load]);

  function selectTab(next: Tab) {
    router.replace(`${basePath}/${endpointId}?tab=${next}`, { scroll: false });
  }

  if (error)
    return (
      <AppShell>
        <LoadError message={error} onRetry={() => void load()} />
      </AppShell>
    );
  if (!endpoint)
    return (
      <AppShell>
        <Skeleton className="h-[70vh]" />
      </AppShell>
    );

  return (
    <AppShell>
      <Link
        href={basePath}
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={13} /> {kind === "mcp" ? "MCP Endpoints" : "HTTP APIs"}
      </Link>
      <PageHeader
        eyebrow={label}
        title={endpoint.name}
        description={endpoint.description}
        actions={
          <>
            <Badge tone={endpoint.status === "deployed" ? "success" : "neutral"}>
              <StatusDot status={endpoint.status} /> {endpoint.status}
            </Badge>
          </>
        }
      />
      <div className="mb-6 overflow-x-auto border-b">
        <div className="flex min-w-max gap-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => selectTab(item.id)}
              className={cn(
                "relative px-3 py-3 text-xs font-medium",
                tab === item.id
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              {tab === item.id && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-primary" />
              )}
            </button>
          ))}
        </div>
      </div>
      {tab === "overview" && <Overview endpoint={endpoint} kind={kind} />}
      {tab === "bindings" && (
        <Bindings endpoint={endpoint} kind={kind} onChanged={load} />
      )}
      {tab === "authentication" && (
        <Authentication endpoint={endpoint} onChanged={load} />
      )}
      {tab === "network" && <NetworkPolicy endpoint={endpoint} onChanged={load} />}
      {tab === "executions" && <Executions endpoint={endpoint} />}
      {tab === "manifest" && <Manifest endpoint={endpoint} />}
      {tab === "settings" && <Settings endpoint={endpoint} onChanged={load} />}
    </AppShell>
  );
}
