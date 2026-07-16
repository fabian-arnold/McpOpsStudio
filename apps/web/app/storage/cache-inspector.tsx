"use client";

import { useState } from "react";
import { Database, KeyRound, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { CacheInspectionItem } from "@/lib/types";

export function CacheInspector({
  environmentId,
  authorized,
}: {
  environmentId: string;
  authorized: boolean;
}) {
  const [items, setItems] = useState<CacheInspectionItem[]>();
  const [cursor, setCursor] = useState("0");
  const [nextCursor, setNextCursor] = useState("0");
  const [prefix, setPrefix] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [revealed, setRevealed] = useState<{ key: string; value: unknown }>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function load(next = "0") {
    if (!authorized || !environmentId) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const params = new URLSearchParams({ environmentId, cursor: next, limit: "50" });
      if (prefix) params.set("prefix", prefix);
      if (tenantId) params.set("tenantId", tenantId);
      const result = await api<{ cursor: string; items: CacheInspectionItem[] }>(
        `/api/storage/cache?${params}`,
      );
      setItems(result.items);
      setCursor(next);
      setNextCursor(result.cursor);
    } catch (reason) {
      setMessage(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function reveal(item: CacheInspectionItem) {
    try {
      const result = await api<{ value: unknown }>("/api/storage/cache/reveal", {
        method: "POST",
        body: JSON.stringify({ environmentId, keyToken: item.keyToken }),
      });
      setRevealed({ key: item.key, value: result.value });
    } catch (reason) {
      setMessage(errorMessage(reason));
    }
  }
  async function remove(item: CacheInspectionItem) {
    if (!(await deleteCacheItem(environmentId, item))) return;
    await load(cursor);
  }
  if (!authorized) return <CacheAccessRestricted />;
  return (
    <section className="panel overflow-hidden">
      <div className="border-b p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="cache-key-prefix">
              Key prefix
            </label>
            <input
              id="cache-key-prefix"
              className="field"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="cache-tenant-id">
              Tenant ID
            </label>
            <input
              id="cache-tenant-id"
              className="field"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
            />
          </div>
          <Button loading={busy} onClick={() => void load()}>
            <RefreshCw size={13} /> Scan cache
          </Button>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Redis SCAN is bounded and cursor-based. Reveals are audited and platform
          secrets are always masked.
        </p>
        {message && <p className="mt-2 text-xs text-red-500">{message}</p>}
      </div>
      {!items ? (
        <EmptyState
          icon={<Search />}
          title="No cache scan yet"
          description="Apply optional scope filters and scan the selected environment."
        />
      ) : !items.length ? (
        <EmptyState
          icon={<Database />}
          title="No keys in this scan page"
          description="Continue the cursor or adjust the filters."
        />
      ) : (
        <div className="divide-y">
          {items.map((item) => (
            <div
              className="grid gap-3 p-4 md:grid-cols-[1fr_160px_100px_auto] md:items-center"
              key={item.keyToken}
            >
              <div className="min-w-0">
                <code className="block truncate text-xs">{item.key}</code>
                <span className="text-[10px] text-muted-foreground">
                  Function {item.functionId} · tenant {item.tenantId ?? "global"}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {item.ttlMs === null
                  ? "no TTL"
                  : `${Math.ceil(item.ttlMs / 1000)}s TTL`}
              </span>
              <span className="text-xs text-muted-foreground">{item.sizeBytes} B</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => void reveal(item)}>
                  Reveal
                </Button>
                <Button size="icon" variant="ghost" onClick={() => void remove(item)}>
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))}
          {nextCursor !== "0" && (
            <div className="p-4">
              <Button variant="secondary" onClick={() => void load(nextCursor)}>
                Continue scan
              </Button>
            </div>
          )}
        </div>
      )}
      {revealed && (
        <div className="border-t p-5">
          <h3 className="text-sm font-semibold">{revealed.key}</h3>
          <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs">
            {JSON.stringify(revealed.value, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}

async function deleteCacheItem(
  environmentId: string,
  item: CacheInspectionItem,
): Promise<boolean> {
  if (!window.confirm(`Delete cache key ${item.key}?`)) return false;
  await api("/api/storage/cache/key", {
    method: "DELETE",
    body: JSON.stringify({ environmentId, keyToken: item.keyToken }),
  });
  return true;
}

function CacheAccessRestricted() {
  return (
    <EmptyState
      icon={<KeyRound />}
      title="Cache inspection restricted"
      description="Only project owners and admins can enumerate cache metadata or reveal redacted values."
    />
  );
}
