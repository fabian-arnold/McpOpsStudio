"use client";

import { useCallback, useEffect, useState } from "react";
import { Database } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Badge, EmptyState, LoadError, PageHeader, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type { DataCollection, EnvironmentSummary, OpsFunction } from "@/lib/types";
import { CacheInspector } from "./cache-inspector";
import { CollectionDetail } from "./collection-detail";
import { CreateCollection } from "./collection-editors";

export default function StoragePage() {
  const user = useCurrentUser();
  const [tab, setTab] = useState<"collections" | "cache">("collections");
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>();
  const [environmentId, setEnvironmentId] = useState("");
  const [functions, setFunctions] = useState<OpsFunction[]>([]);
  const [collections, setCollections] = useState<DataCollection[]>();
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const canDefine = roleAllows(user?.role, ["owner", "admin", "developer"]);
  const canInspect = roleAllows(user?.role, ["owner", "admin"]);

  useEffect(() => {
    Promise.all([
      api<EnvironmentSummary[]>("/api/environments"),
      api<OpsFunction[]>("/api/functions"),
    ])
      .then(([loadedEnvironments, loadedFunctions]) => {
        setEnvironments(loadedEnvironments);
        setEnvironmentId((current) => current || loadedEnvironments[0]?.id || "");
        setFunctions(loadedFunctions);
      })
      .catch((reason) => setError(errorMessage(reason)));
  }, []);
  const load = useCallback(() => {
    if (!environmentId) return;
    setError(undefined);
    api<DataCollection[]>(
      `/api/data-collections?environmentId=${encodeURIComponent(environmentId)}`,
    )
      .then((loaded) => {
        setCollections(loaded);
        setSelectedId((current) =>
          loaded.some((item) => item.id === current) ? current : loaded[0]?.id,
        );
      })
      .catch((reason) => setError(errorMessage(reason)));
  }, [environmentId]);
  useEffect(load, [load, refresh]);
  const selected = collections?.find((item) => item.id === selectedId);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Project"
        title="Storage"
        description="Typed PostgreSQL collections and bounded Redis cache inspection. Collection queries execute in PostgreSQL with tenant and environment scope applied by the platform."
        actions={
          <select
            aria-label="Environment"
            className="field min-w-44"
            value={environmentId}
            onChange={(event) => setEnvironmentId(event.target.value)}
          >
            {environments?.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name}
              </option>
            ))}
          </select>
        }
      />
      <StorageTabs tab={tab} onChange={setTab} />
      {error ? (
        <LoadError message={error} onRetry={() => setRefresh((value) => value + 1)} />
      ) : tab === "cache" ? (
        <CacheInspector environmentId={environmentId} authorized={canInspect} />
      ) : !collections ? (
        <Skeleton className="h-[60vh]" />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b p-4">
              <div>
                <h2 className="text-sm font-semibold">Data objects</h2>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {collections.length} collection{collections.length === 1 ? "" : "s"}
                </p>
              </div>
              {canDefine && (
                <CreateCollection onCreated={() => setRefresh((value) => value + 1)} />
              )}
            </div>
            <div className="p-2">
              {collections.map((collection) => (
                <button
                  className={`mb-1 w-full rounded-lg p-3 text-left ${
                    selectedId === collection.id ? "bg-primary/10" : "hover:bg-muted"
                  }`}
                  key={collection.id}
                  onClick={() => setSelectedId(collection.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {collection.name}
                    </span>
                    <Badge tone={collection.enabled ? "success" : "neutral"}>
                      v{collection.latestVersion?.version ?? 0}
                    </Badge>
                  </span>
                  <code className="mt-1 block truncate text-[10px] text-muted-foreground">
                    {collection.slug}
                  </code>
                  <span className="mt-2 block text-[11px] text-muted-foreground">
                    {collection.recordCount ?? 0} records · {collection.grants.length}{" "}
                    grants
                  </span>
                </button>
              ))}
              {!collections.length && (
                <EmptyState
                  icon={<Database />}
                  title="No collections"
                  description="Define a typed object schema and grant it to a Function."
                />
              )}
            </div>
          </section>
          {selected ? (
            <CollectionDetail
              collection={selected}
              environmentId={environmentId}
              functions={functions}
              canDefine={canDefine}
              canInspect={canInspect}
              onChanged={() => setRefresh((value) => value + 1)}
            />
          ) : (
            <EmptyState
              icon={<Database />}
              title="Select a collection"
              description="Schema, indexes, grants, and collection records appear here."
            />
          )}
        </div>
      )}
    </AppShell>
  );
}
function StorageTabs({
  tab,
  onChange,
}: {
  tab: "collections" | "cache";
  onChange: (tab: "collections" | "cache") => void;
}) {
  return (
    <div className="mb-6 flex gap-1 border-b">
      {(["collections", "cache"] as const).map((item) => (
        <button
          className={`border-b-2 px-4 py-3 text-xs font-medium ${
            tab === item
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground"
          }`}
          key={item}
          onClick={() => onChange(item)}
        >
          {item === "collections" ? "Collections" : "Cache"}
        </button>
      ))}
    </div>
  );
}
