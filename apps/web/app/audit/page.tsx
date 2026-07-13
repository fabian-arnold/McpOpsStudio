"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
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
import { downloadText } from "@/lib/download";
import type { AuditEvent } from "@/lib/types";

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

  const actionOptions = useMemo(
    () =>
      [...new Set(items?.map((item) => item.action) ?? [])].sort((left, right) =>
        actionLabel(left).localeCompare(actionLabel(right)),
      ),
    [items],
  );
  const displayedItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items?.filter((item) => {
      if (actionFilter && item.action !== actionFilter) return false;
      if (!normalizedQuery) return true;
      return [
        item.action,
        actionLabel(item.action),
        item.actor,
        actorLabel(item),
        item.targetType,
        humanize(item.targetType),
        item.targetId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [actionFilter, items, query]);

  const filtersActive = Boolean(query || actionFilter);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Security"
        title="Audit log"
        description="A permanent history of important changes, deployments, access decisions, and security operations."
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
            Export results
          </Button>
        }
      />

      <section className="panel mb-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative block flex-1">
            <span className="sr-only">Search audit events</span>
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={14}
            />
            <input
              className="field h-9 w-full pl-9 text-xs"
              placeholder="Search actions, actors, or affected resources..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Filter by action</span>
            <select
              className="field h-9 w-full py-1 text-xs lg:w-64"
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
            >
              <option value="">All event types</option>
              {actionOptions.map((action) => (
                <option key={action} value={action}>
                  {actionLabel(action)}
                </option>
              ))}
            </select>
          </label>
          {filtersActive && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setQuery("");
                setActionFilter("");
              }}
            >
              <X size={13} />
              Clear
            </Button>
          )}
        </div>
        {items && (
          <p className="mt-3 text-[11px] text-muted-foreground" aria-live="polite">
            Showing {displayedItems?.length ?? 0} of {items.length} events
          </p>
        )}
      </section>

      {loadError ? (
        <LoadError
          title="Unable to load audit events"
          message={loadError}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : !displayedItems ? (
        <Skeleton className="h-80" />
      ) : displayedItems.length ? (
        <div className="panel overflow-hidden divide-y">
          {displayedItems.map((item) => (
            <AuditEventRow item={item} key={item.id} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<ShieldCheck />}
          title={filtersActive ? "No matching events" : "No audit events yet"}
          description={
            filtersActive
              ? "Try a broader search or clear the selected event type."
              : "Important platform and runtime activity will appear here automatically."
          }
          action={
            filtersActive ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setActionFilter("");
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )}
    </AppShell>
  );
}

function AuditEventRow({ item }: { item: AuditEvent }) {
  const presentation = actionPresentation(item.action);
  const Icon = presentation.icon;
  const exactTime = new Date(item.createdAt).toLocaleString();

  return (
    <article className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <span className={`grid size-9 shrink-0 place-items-center rounded-full ${presentation.iconClass}`}>
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{actionLabel(item.action)}</h2>
          <Badge tone={presentation.tone}>{presentation.category}</Badge>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          <span title={item.actor}>{actorLabel(item)}</span>
          <span className="mx-1.5" aria-hidden="true">·</span>
          <span>{humanize(item.targetType)}</span>
          {item.targetId && (
            <>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <code
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground"
                title={item.targetId}
              >
                {shortIdentifier(item.targetId)}
              </code>
            </>
          )}
        </p>
      </div>
      <time
        className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground sm:pt-1"
        dateTime={item.createdAt}
        title={exactTime}
      >
        <Clock3 size={12} />
        {relativeTime(item.createdAt)}
      </time>
    </article>
  );
}

function humanize(value: string) {
  const words = value.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Unknown";
}

function actionLabel(action: string) {
  return humanize(action);
}

function actorLabel(item: AuditEvent) {
  const actorType = item.actorType ?? item.actor.split(":", 1)[0];
  const actorId = item.actorId ?? item.actor.split(":").slice(1).join(":");
  if (actorType === "system") return "MCP Ops Studio";
  if (actorType === "caller")
    return actorId ? `Runtime caller ${shortIdentifier(actorId)}` : "Runtime caller";
  if (actorType === "user")
    return actorId ? `Platform user ${shortIdentifier(actorId)}` : "Platform user";
  return humanize(actorType || item.actor);
}

function shortIdentifier(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function relativeTime(value: string) {
  const elapsedSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1_000);
  const intervals: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, seconds] of intervals) {
    if (Math.abs(elapsedSeconds) >= seconds)
      return formatter.format(Math.round(elapsedSeconds / seconds), unit);
  }
  return formatter.format(elapsedSeconds, "second");
}

function actionPresentation(action: string): {
  category: string;
  icon: typeof ShieldCheck;
  iconClass: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
} {
  if (/(denied|failed|deleted|removed|revoked)/i.test(action))
    return {
      category: "Attention",
      icon: AlertTriangle,
      iconClass: "bg-red-500/10 text-red-600 dark:text-red-400",
      tone: "danger",
    };
  if (/(queued|rotated|disabled|archived|rolled_back)/i.test(action))
    return {
      category: "Change",
      icon: Clock3,
      iconClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      tone: "warning",
    };
  if (/(created|activated|installed|enabled|updated|changed)/i.test(action))
    return {
      category: "Completed",
      icon: CheckCircle2,
      iconClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      tone: "success",
    };
  return {
    category: "Recorded",
    icon: ShieldCheck,
    iconClass: "bg-primary/10 text-primary",
    tone: "info",
  };
}
