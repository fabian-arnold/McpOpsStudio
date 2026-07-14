"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, RefreshCw, Search } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Badge, Button, EmptyState, LoadError, PageHeader, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { downloadText } from "@/lib/download";
import type { EnvironmentSummary, RuntimeLog } from "@/lib/types";

type LogResult = {
  items: RuntimeLog[];
  nextCursor?: string;
  summary: { count: number; sizeBytes: number; levels: Record<string, number> };
};
type Range = "15m" | "1h" | "24h" | "7d" | "all";

export default function LogsPage() {
  const [items, setItems] = useState<RuntimeLog[]>();
  const [summary, setSummary] = useState<LogResult["summary"]>();
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [range, setRange] = useState<Range>("1h");
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async (append = false) => {
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (q.trim()) params.set("q", q.trim());
      if (level) params.set("level", level);
      if (environmentId) params.set("environmentId", environmentId);
      const from = rangeStart(range);
      if (from) params.set("from", from.toISOString());
      if (append && nextCursor) params.set("cursor", nextCursor);
      const result = await api<LogResult>(`/api/logs?${params}`);
      setItems((current) => append ? [...(current ?? []), ...result.items] : result.items);
      setSummary(result.summary);
      setNextCursor(result.nextCursor);
      setError(undefined);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [environmentId, level, nextCursor, q, range]);

  useEffect(() => { api<EnvironmentSummary[]>("/api/environments").then(setEnvironments).catch(() => setEnvironments([])); }, []);
  useEffect(() => { void load(false); }, [environmentId, level, q, range]);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => void load(false), 5000);
    return () => window.clearInterval(timer);
  }, [live, load]);

  const exported = useMemo(() => items ?? [], [items]);
  return (
    <AppShell>
      <PageHeader eyebrow="Observability" title="Logs" description="Search structured, redacted Function logs across the selected Project." actions={<Button variant="secondary" disabled={!exported.length} onClick={() => downloadText("runtime-logs.json", JSON.stringify(exported, null, 2), "application/json")}><Download size={14} /> Export masked JSON</Button>} />
      <section className="panel overflow-hidden">
        <div className="border-b bg-muted/20 p-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-64 flex-1"><Search size={14} className="absolute left-3 top-3 text-muted-foreground" /><input className="field h-10 pl-9 font-mono text-xs" value={q} onChange={(event) => setQ(event.target.value)} placeholder='Search messages, Functions, endpoints, request IDs…' /></div>
            <select className="field h-10 w-40" value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}><option value="">All environments</option>{environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}</select>
            <select className="field h-10 w-32" value={level} onChange={(event) => setLevel(event.target.value)}><option value="">All levels</option>{["debug", "info", "warn", "error"].map((value) => <option key={value}>{value}</option>)}</select>
            <select className="field h-10 w-32" value={range} onChange={(event) => setRange(event.target.value as Range)}><option value="15m">Last 15 min</option><option value="1h">Last hour</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="all">All retained</option></select>
            <Button variant={live ? "primary" : "secondary"} onClick={() => setLive((value) => !value)}>{live ? "Live · 5s" : "Start live"}</Button>
            <Button size="icon" variant="secondary" aria-label="Refresh logs" onClick={() => void load(false)}><RefreshCw size={14} /></Button>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">Graylog-style structured search across message, Function, endpoint, request ID, and correlation ID. Dedicated filters remain exact.</p>
        </div>
        {summary && <LogSummary summary={summary} />}
        {error ? <div className="p-4"><LoadError title="Logs unavailable" message={error} onRetry={() => void load(false)} /></div> : !items ? <Skeleton className="m-4 h-96" /> : items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1050px] table-fixed text-left"><thead><tr className="border-b bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground"><th className="w-8" /><th className="w-44 px-2 py-2">Timestamp</th><th className="w-20 px-2 py-2">Level</th><th className="w-52 px-2 py-2">Source</th><th className="px-2 py-2">Message</th><th className="w-64 px-2 py-2">Request</th></tr></thead><tbody>{items.map((item) => <LogRow key={item.id} item={item} />)}</tbody></table></div> : <EmptyState icon={<Search />} title="No matching logs" description="No retained Function logs match this search and time range." />}
        {nextCursor && <div className="flex justify-center border-t p-3"><Button variant="secondary" onClick={() => void load(true)}>Load older messages</Button></div>}
      </section>
    </AppShell>
  );
}

function LogSummary({ summary }: { summary: LogResult["summary"] }) {
  const levels = ["debug", "info", "warn", "error"];
  return <div className="grid gap-3 border-b p-3 md:grid-cols-[160px_160px_1fr]"><div><p className="text-[10px] uppercase text-muted-foreground">Matching messages</p><p className="text-lg font-semibold">{summary.count.toLocaleString()}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Stored size</p><p className="text-lg font-semibold">{formatBytes(summary.sizeBytes)}</p></div><div className="flex items-end gap-1">{levels.map((level) => { const count = summary.levels[level] ?? 0; const width = summary.count ? Math.max(3, count / summary.count * 100) : 0; return <div key={level} className="min-w-10" style={{ width: `${width}%` }}><p className="mb-1 truncate text-[9px] text-muted-foreground">{level} · {count}</p><div className={`h-2 rounded-full ${level === "error" ? "bg-red-500" : level === "warn" ? "bg-amber-500" : level === "info" ? "bg-sky-500" : "bg-slate-400"}`} /></div>; })}</div></div>;
}

function LogRow({ item }: { item: RuntimeLog }) {
  const [open, setOpen] = useState(false);
  return <><tr className="border-b align-top hover:bg-muted/20"><td className="py-2 pl-2"><button onClick={() => setOpen((value) => !value)} aria-label="Toggle log fields">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button></td><td className="px-2 py-2 font-mono text-[10px] text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</td><td className="px-2 py-2"><Badge tone={item.level === "error" ? "danger" : item.level === "warn" ? "warning" : item.level === "info" ? "info" : "neutral"}>{item.level}</Badge></td><td className="px-2 py-2"><Link href={`/functions/${item.function.id}`} className="block truncate font-mono text-[10px] hover:text-primary">{item.function.slug}</Link><span className="block truncate text-[9px] text-muted-foreground">{item.environment.name} · {item.endpoint.name}</span></td><td className="px-2 py-2 font-mono text-[11px] leading-5">{item.message}</td><td className="px-2 py-2 font-mono text-[9px] text-muted-foreground"><span className="block truncate" title={item.requestId}>{item.requestId}</span>{item.correlationId && <span className="block truncate" title={item.correlationId}>corr: {item.correlationId}</span>}</td></tr>{open && <tr className="border-b bg-muted/10"><td /><td colSpan={5} className="p-3"><pre className="max-h-64 overflow-auto rounded-lg bg-[#0b0d14] p-3 font-mono text-[10px] leading-5 text-slate-300">{JSON.stringify({ metadata: item.metadata ?? {}, executionId: item.executionId, deploymentId: item.deploymentId, sizeBytes: item.sizeBytes }, null, 2)}</pre></td></tr>}</>;
}

function rangeStart(range: Range) { const duration = range === "15m" ? 900000 : range === "1h" ? 3600000 : range === "24h" ? 86400000 : range === "7d" ? 604800000 : 0; return duration ? new Date(Date.now() - duration) : undefined; }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1048576) return `${(value / 1024).toFixed(1)} KiB`; return `${(value / 1048576).toFixed(1)} MiB`; }
