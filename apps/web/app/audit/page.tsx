"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Download, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  Button,
  EmptyState,
  LoadError,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { AuditEvent } from "@/lib/types";
import { downloadText } from "@/lib/download";
export default function AuditPage() {
  const [items, setItems] = useState<AuditEvent[]>();
  const [loadError, setLoadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const load = useCallback(() => {
    setItems(undefined);
    setLoadError(undefined);
    api<{ items: AuditEvent[]; nextCursor?: string }>("/api/audit-events")
      .then((result) => setItems(result.items))
      .catch((error) => setLoadError(errorMessage(error)));
  }, []);
  useEffect(load, [attempt, load]);
  const displayedItems = useMemo(
    () =>
      items?.filter(
        (item) =>
          (!actionFilter || item.action === actionFilter) &&
          (!query ||
            `${item.actor} ${item.targetType} ${item.targetId ?? ""}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [actionFilter, items, query],
  );
  return (
    <AppShell>
      <PageHeader
        eyebrow="Security"
        title="Audit log"
        description="Immutable records of deployments, configuration changes, denials, and sensitive operations."
        actions={
          <Button
            variant="secondary"
            disabled={!displayedItems?.length}
            onClick={() =>
              displayedItems &&
              downloadText(
                "audit-events.json",
                JSON.stringify(displayedItems, null, 2),
                "application/json",
              )
            }
          >
            <Download size={14} />
            Export filtered
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="field h-9 w-72 text-xs"
          placeholder="Actor, target type, or target ID…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="field h-9 w-56 py-1 text-xs"
          value={actionFilter}
          onChange={(event) => setActionFilter(event.target.value)}
        >
          <option value="">All actions</option>
          {[...new Set(items?.map((item) => item.action) ?? [])].map(
            (action) => (
              <option key={action}>{action}</option>
            ),
          )}
        </select>
      </div>
      {loadError ? (
        <LoadError
          title="Unable to load audit events"
          message={loadError}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : !displayedItems ? (
        <Skeleton className="h-80" />
      ) : displayedItems.length ? (
        <div className="panel divide-y">
          {displayedItems.map((item) => (
            <div className="flex items-center gap-4 p-4" key={item.id}>
              <span className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary">
                <ShieldCheck size={15} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold">
                  {item.action.replaceAll(".", " ")}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {item.actor} · {item.targetType}: {item.targetId ?? "—"}
                </p>
              </div>
              <Badge className="ml-auto">immutable</Badge>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock3 size={11} />
                {new Date(item.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<ShieldCheck />}
          title="No audit events"
          description="Platform and runtime actions will appear here."
        />
      )}
    </AppShell>
  );
}
