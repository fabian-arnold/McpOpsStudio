"use client";

import { useCallback, useEffect, useState } from "react";
import { Network } from "lucide-react";
import { AppShell } from "@/components/shell";
import { BindingMap } from "@/components/binding-map";
import { LoadError, PageHeader, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { OpsFunction } from "@/lib/types";

export default function EndpointMapPage() {
  const [functions, setFunctions] = useState<OpsFunction[]>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    setError(undefined);
    api<OpsFunction[]>("/api/functions").then(setFunctions).catch((reason) => setError(errorMessage(reason)));
  }, []);
  useEffect(load, [load]);
  return (
    <AppShell>
      <PageHeader
        eyebrow="Project"
        title="Endpoint Map"
        description="Drag reusable Functions onto MCP Endpoints and HTTP APIs to configure how code is exposed. This map edits bindings only; executable composition remains TypeScript."
        actions={<span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Network size={17} /></span>}
      />
      {error ? (
        <LoadError title="Endpoint map unavailable" message={error} onRetry={load} />
      ) : functions ? (
        <BindingMap functions={functions} />
      ) : (
        <Skeleton className="h-[520px]" />
      )}
    </AppShell>
  );
}
