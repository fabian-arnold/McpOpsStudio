"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Wrench } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Button, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

import { TemplateCard } from "./template-card";
import type { RuntimeEndpoint, Template } from "./template-types";

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [endpoints, setEndpoints] = useState<RuntimeEndpoint[]>([]);
  const [endpointId, setEndpointId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const [catalog, endpointRows] = await Promise.all([
        api<Template[]>("/api/templates"),
        api<RuntimeEndpoint[]>("/api/runtime-endpoints"),
      ]);
      setTemplates(catalog);
      setEndpoints(endpointRows);
      setEndpointId((current) => current || endpointRows[0]?.id || "");
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === endpointId),
    [endpointId, endpoints],
  );
  return (
    <AppShell>
      <PageHeader
        eyebrow="Build"
        title="Operational templates"
        description="Complete operational units from the canonical server catalog, with configuration proven before installation."
      />
      <div className="panel mb-5 flex flex-wrap items-center gap-3 p-4">
        <label className="text-xs font-medium" htmlFor="template-endpoint">
          Install into
        </label>
        <select
          id="template-endpoint"
          className="field min-w-60"
          value={endpointId}
          onChange={(event) => setEndpointId(event.target.value)}
          disabled={loading || endpoints.length === 0}
        >
          {endpoints.length === 0 ? (
            <option value="">No endpoints available</option>
          ) : (
            endpoints.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.name}
                {endpoint.environment?.name ? ` · ${endpoint.environment.name}` : ""}
              </option>
            ))
          )}
        </select>
      </div>
      {loading && <Skeleton className="h-80" />}
      {loadError && (
        <div className="panel flex items-center justify-between gap-4 border-destructive/30 p-5">
          <div>
            <p className="text-sm font-medium">Template catalog unavailable</p>
            <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
          </div>
          <Button variant="secondary" onClick={() => void load()}>
            <RefreshCw size={13} />
            Retry
          </Button>
        </div>
      )}
      {!loading && !loadError && templates.length === 0 && (
        <EmptyState
          icon={<Wrench />}
          title="No published templates"
          description="This control plane did not return a template catalog."
        />
      )}
      {!loading && !loadError && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {templates.map((template) => (
            <TemplateCard
              template={template}
              endpointId={endpointId}
              endpointName={selectedEndpoint?.name}
              key={template.id}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}
