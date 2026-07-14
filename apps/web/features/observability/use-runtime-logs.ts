"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { EnvironmentSummary, RuntimeLog } from "@/lib/types";

export type LogResult = {
  items: RuntimeLog[];
  nextCursor?: string;
  summary: { count: number; sizeBytes: number; levels: Record<string, number> };
};
export type LogRange = "15m" | "1h" | "24h" | "7d" | "all";

export function useRuntimeLogs() {
  const [items, setItems] = useState<RuntimeLog[]>();
  const [summary, setSummary] = useState<LogResult["summary"]>();
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [range, setRange] = useState<LogRange>("1h");
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string>();
  const requestGeneration = useRef(0);

  const loadLogs = useCallback(
    async (cursor?: string, signal?: AbortSignal) => {
      const generation = ++requestGeneration.current;
      try {
        const params = logSearchParams({
          q,
          level,
          environmentId,
          range,
          ...(cursor ? { cursor } : {}),
        });
        const result = await api<LogResult>(
          `/api/logs?${params}`,
          signal ? { signal } : undefined,
        );
        if (signal?.aborted || generation !== requestGeneration.current) return;
        setItems((current) =>
          cursor ? [...(current ?? []), ...result.items] : result.items,
        );
        setSummary(result.summary);
        setNextCursor(result.nextCursor);
        setError(undefined);
      } catch (reason) {
        if (signal?.aborted || generation !== requestGeneration.current) return;
        setError(errorMessage(reason));
      }
    },
    [environmentId, level, q, range],
  );

  useEffect(() => {
    void api<EnvironmentSummary[]>("/api/environments")
      .then(setEnvironments)
      .catch(() => setEnvironments([]));
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void loadLogs(undefined, controller.signal);
    return () => controller.abort();
  }, [loadLogs]);
  useEffect(() => {
    if (!live) return;
    let controller: AbortController | undefined;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      void loadLogs(undefined, controller.signal);
    };
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [live, loadLogs]);

  return {
    items,
    summary,
    environments,
    nextCursor,
    q,
    setQ,
    level,
    setLevel,
    environmentId,
    setEnvironmentId,
    range,
    setRange,
    live,
    setLive,
    error,
    loadLogs,
  };
}

function logSearchParams(input: {
  q: string;
  level: string;
  environmentId: string;
  range: LogRange;
  cursor?: string;
}): URLSearchParams {
  const params = new URLSearchParams({ limit: "200" });
  if (input.q.trim()) params.set("q", input.q.trim());
  if (input.level) params.set("level", input.level);
  if (input.environmentId) params.set("environmentId", input.environmentId);
  const from = rangeStart(input.range);
  if (from) params.set("from", from.toISOString());
  if (input.cursor) params.set("cursor", input.cursor);
  return params;
}

function rangeStart(range: LogRange): Date | undefined {
  const durations: Record<LogRange, number> = {
    "15m": 900_000,
    "1h": 3_600_000,
    "24h": 86_400_000,
    "7d": 604_800_000,
    all: 0,
  };
  return durations[range] ? new Date(Date.now() - durations[range]) : undefined;
}
