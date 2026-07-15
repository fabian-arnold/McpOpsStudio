"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, KeyRound, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  LoadError,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type {
  CacheInspectionItem,
  DataCollection,
  DataCollectionRecord,
  EnvironmentSummary,
  OpsFunction,
} from "@/lib/types";

const starterSchema = JSON.stringify(
  {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1 },
      status: { type: "string" },
    },
  },
  null,
  2,
);
const starterIndexes = JSON.stringify(
  [{ name: "by_status", kind: "btree", fields: ["status"], unique: false }],
  null,
  2,
);

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
      <div className="mb-6 flex gap-1 border-b">
        {(["collections", "cache"] as const).map((item) => (
          <button
            className={`border-b-2 px-4 py-3 text-xs font-medium ${
              tab === item
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground"
            }`}
            key={item}
            onClick={() => setTab(item)}
          >
            {item === "collections" ? "Collections" : "Cache"}
          </button>
        ))}
      </div>
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
              description="Schema, indexes, grants, and tenant records appear here."
            />
          )}
        </div>
      )}
    </AppShell>
  );
}

function CreateCollection({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [schema, setSchema] = useState(starterSchema);
  const [indexes, setIndexes] = useState(starterIndexes);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  async function create() {
    setBusy(true);
    setMessage(undefined);
    try {
      await api("/api/data-collections", {
        method: "POST",
        body: JSON.stringify({
          name,
          slug,
          description,
          schema: JSON.parse(schema),
          indexes: JSON.parse(indexes),
        }),
      });
      setOpen(false);
      onCreated();
    } catch (reason) {
      setMessage(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="icon" aria-label="Create collection">
          <Plus size={14} />
        </Button>
      }
      title="Create data collection"
      description="The schema becomes immutable version 1. Grant and deploy it before writing records."
    >
      <div className="space-y-3">
        <input
          className="field"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="field font-mono"
          placeholder="slug_with_underscores"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <textarea
          className="field min-h-20"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label className="label">JSON Schema</label>
        <textarea
          className="field min-h-64 font-mono text-xs"
          value={schema}
          onChange={(e) => setSchema(e.target.value)}
        />
        <label className="label">PostgreSQL indexes</label>
        <textarea
          className="field min-h-32 font-mono text-xs"
          value={indexes}
          onChange={(e) => setIndexes(e.target.value)}
        />
        {message && <p className="text-xs text-red-500">{message}</p>}
        <Button className="w-full" loading={busy} onClick={() => void create()}>
          Create collection
        </Button>
      </div>
    </Dialog>
  );
}

function CollectionDetail({
  collection,
  environmentId,
  functions,
  canDefine,
  canInspect,
  onChanged,
}: {
  collection: DataCollection;
  environmentId: string;
  functions: OpsFunction[];
  canDefine: boolean;
  canInspect: boolean;
  onChanged: () => void;
}) {
  const [tenantId, setTenantId] = useState("default");
  const [queryText, setQueryText] = useState(
    JSON.stringify(
      { orderBy: [{ field: "createdAt", direction: "desc" }], limit: 50 },
      null,
      2,
    ),
  );
  const [records, setRecords] = useState<DataCollectionRecord[]>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [queryWarnings, setQueryWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState<string>();
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordText, setRecordText] = useState("{}");
  const [editing, setEditing] = useState<DataCollectionRecord>();
  const [busy, setBusy] = useState(false);
  const [grantFunctionId, setGrantFunctionId] = useState("");
  const [grantPermissions, setGrantPermissions] = useState(["read"]);

  const declaredFields = useMemo(
    () =>
      Object.keys(
        (collection.latestVersion?.schema.properties as Record<string, unknown>) ?? {},
      ),
    [collection.latestVersion?.schema.properties],
  );
  async function runQuery(cursor?: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      const query = JSON.parse(queryText) as Record<string, unknown>;
      const result = await api<{
        items: DataCollectionRecord[];
        nextCursor?: string;
        warnings?: string[];
      }>(`/api/data-collections/${collection.id}/records/query`, {
        method: "POST",
        body: JSON.stringify({
          environmentId,
          tenantId,
          ...query,
          ...(cursor ? { cursor } : {}),
        }),
      });
      setRecords(result.items);
      setNextCursor(result.nextCursor);
      setQueryWarnings(result.warnings ?? []);
    } catch (reason) {
      setMessage(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function saveRecord() {
    setBusy(true);
    try {
      await api(
        editing
          ? `/api/data-collections/${collection.id}/records/${editing.id}`
          : `/api/data-collections/${collection.id}/records`,
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify({
            environmentId,
            tenantId,
            data: JSON.parse(recordText),
            ...(editing ? { revision: editing.revision } : {}),
          }),
        },
      );
      setRecordOpen(false);
      setEditing(undefined);
      await runQuery();
      onChanged();
    } catch (reason) {
      setMessage(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function remove(record: DataCollectionRecord) {
    if (!window.confirm(`Permanently delete record ${record.id}?`)) return;
    try {
      await api(`/api/data-collections/${collection.id}/records/${record.id}`, {
        method: "DELETE",
        body: JSON.stringify({ environmentId, tenantId, revision: record.revision }),
      });
      await runQuery();
      onChanged();
    } catch (reason) {
      setMessage(errorMessage(reason));
    }
  }
  async function grant() {
    if (!grantFunctionId) return;
    try {
      await api(`/api/data-collections/${collection.id}/grants`, {
        method: "PUT",
        body: JSON.stringify({
          functionId: grantFunctionId,
          permissions: grantPermissions,
        }),
      });
      setGrantFunctionId("");
      onChanged();
    } catch (reason) {
      setMessage(errorMessage(reason));
    }
  }
  async function revoke(grantId: string) {
    if (!window.confirm("Revoke this collection grant in the next deployment?")) return;
    try {
      await api(`/api/data-collections/${collection.id}/grants/${grantId}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (reason) {
      setMessage(errorMessage(reason));
    }
  }
  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{collection.name}</h2>
              <Badge>v{collection.latestVersion?.version}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {collection.description || collection.slug}
            </p>
          </div>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>{declaredFields.length} fields</span>
            <span>·</span>
            <span>{collection.latestVersion?.indexes.length ?? 0} indexes</span>
            {canDefine && collection.latestVersion && (
              <NewCollectionVersion collection={collection} onCreated={onChanged} />
            )}
          </div>
        </div>
        <details className="mt-4 rounded-lg border p-3">
          <summary className="cursor-pointer text-xs font-medium">
            Schema and indexes
          </summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <pre className="overflow-auto rounded-lg bg-muted p-3 text-[11px]">
              {JSON.stringify(collection.latestVersion?.schema, null, 2)}
            </pre>
            <pre className="overflow-auto rounded-lg bg-muted p-3 text-[11px]">
              {JSON.stringify(collection.latestVersion?.indexes, null, 2)}
            </pre>
          </div>
        </details>
        {canInspect && (
          <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="min-w-56 flex-1">
              <label className="label">Grant collection capabilities to Function</label>
              <select
                className="field"
                value={grantFunctionId}
                onChange={(e) => setGrantFunctionId(e.target.value)}
              >
                <option value="">Select Function</option>
                {functions.map((fn) => (
                  <option key={fn.id} value={fn.id}>
                    {fn.name}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex gap-4">
                {["read", "write", "delete"].map((permission) => (
                  <label className="flex items-center gap-1.5 text-xs" key={permission}>
                    <input
                      type="checkbox"
                      checked={grantPermissions.includes(permission)}
                      onChange={(event) =>
                        setGrantPermissions((current) =>
                          event.target.checked
                            ? [...new Set([...current, permission])]
                            : current.filter((item) => item !== permission),
                        )
                      }
                    />
                    {permission}
                  </label>
                ))}
              </div>
            </div>
            <Button
              variant="secondary"
              onClick={() => void grant()}
              disabled={!grantFunctionId || !grantPermissions.length}
            >
              <KeyRound size={13} /> Grant
            </Button>
          </div>
        )}
        {!!collection.grants.length && (
          <div className="mt-3 flex flex-wrap gap-2">
            {collection.grants.map((grant) => (
              <span className="inline-flex items-center gap-1" key={grant.id}>
                <Badge tone="info">
                  {grant.function.slug}: {grant.permissions.join(", ")}
                </Badge>
                {canInspect && (
                  <button
                    className="text-xs text-muted-foreground hover:text-red-500"
                    onClick={() => void revoke(grant.id)}
                    aria-label={`Revoke ${grant.function.slug}`}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </section>
      <section className="panel overflow-hidden">
        <div className="border-b p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Tenant ID</label>
              <input
                className="field w-56 font-mono"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
              />
            </div>
            <Button
              loading={busy}
              onClick={() => void runQuery()}
              disabled={!canInspect}
            >
              <Search size={13} /> Query PostgreSQL
            </Button>
            {canInspect && (
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(undefined);
                  setRecordText("{}");
                  setRecordOpen(true);
                }}
              >
                <Plus size={13} /> New record
              </Button>
            )}
          </div>
          <label className="label mt-4">Query DSL</label>
          <textarea
            className="field min-h-32 font-mono text-xs"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Supports nested and/or/not filters, typed comparisons, string and array
            operators, projection, multi-field sorting, and cursor limits. Unindexed
            shapes remain database-side and may scan.
          </p>
          {message && <p className="mt-2 text-xs text-red-500">{message}</p>}
          {queryWarnings.map((warning) => (
            <p
              className="mt-2 text-xs text-amber-600 dark:text-amber-400"
              key={warning}
            >
              {warning}
            </p>
          ))}
        </div>
        {!canInspect ? (
          <EmptyState
            icon={<Database />}
            title="Record access restricted"
            description="Only project owners and admins may inspect or mutate tenant records."
          />
        ) : !records ? (
          <EmptyState
            icon={<Search />}
            title="Run a tenant query"
            description="No records are loaded until an explicit bounded query is executed."
          />
        ) : !records.length ? (
          <EmptyState
            icon={<Database />}
            title="No matching records"
            description="Adjust the tenant or query predicates."
          />
        ) : (
          <div className="divide-y">
            {records.map((record) => (
              <div className="p-4" key={record.id}>
                <div className="flex items-center justify-between gap-3">
                  <code className="truncate text-[11px]">{record.id}</code>
                  <div className="flex items-center gap-2">
                    <Badge>rev {record.revision}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(record);
                        setRecordText(JSON.stringify(record.data, null, 2));
                        setRecordOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete record"
                      onClick={() => void remove(record)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
                <pre className="mt-3 max-h-52 overflow-auto rounded-lg bg-muted p-3 text-[11px]">
                  {JSON.stringify(record.data, null, 2)}
                </pre>
              </div>
            ))}
            {nextCursor && (
              <div className="p-4">
                <Button variant="secondary" onClick={() => void runQuery(nextCursor)}>
                  Next page
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
      <Dialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        trigger={<span />}
        title={editing ? "Edit tenant record" : "Create tenant record"}
        description="Writes are validated against the active deployed schema and use optimistic revisions."
      >
        <textarea
          className="field min-h-80 font-mono text-xs"
          value={recordText}
          onChange={(e) => setRecordText(e.target.value)}
        />
        <Button
          className="mt-4 w-full"
          loading={busy}
          onClick={() => void saveRecord()}
        >
          Save record
        </Button>
      </Dialog>
    </div>
  );
}

function NewCollectionVersion({
  collection,
  onCreated,
}: {
  collection: DataCollection;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [schema, setSchema] = useState(
    JSON.stringify(collection.latestVersion?.schema ?? {}, null, 2),
  );
  const [indexes, setIndexes] = useState(
    JSON.stringify(collection.latestVersion?.indexes ?? [], null, 2),
  );
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    setMessage(undefined);
    try {
      await api(`/api/data-collections/${collection.id}/versions`, {
        method: "POST",
        body: JSON.stringify({
          schema: JSON.parse(schema),
          indexes: JSON.parse(indexes),
        }),
      });
      setOpen(false);
      onCreated();
    } catch (reason) {
      setMessage(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" variant="secondary">
          New version
        </Button>
      }
      title={`Create ${collection.slug} schema version`}
      description="Existing records allow only conservative compatible changes. Runtime traffic changes after deployment."
    >
      <label className="label">JSON Schema</label>
      <textarea
        className="field min-h-64 font-mono text-xs"
        value={schema}
        onChange={(event) => setSchema(event.target.value)}
      />
      <label className="label mt-3">PostgreSQL indexes</label>
      <textarea
        className="field min-h-36 font-mono text-xs"
        value={indexes}
        onChange={(event) => setIndexes(event.target.value)}
      />
      {message && <p className="mt-2 text-xs text-red-500">{message}</p>}
      <Button className="mt-4 w-full" loading={busy} onClick={() => void create()}>
        Create immutable version
      </Button>
    </Dialog>
  );
}

function CacheInspector({
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
    if (!window.confirm(`Delete cache key ${item.key}?`)) return;
    await api("/api/storage/cache/key", {
      method: "DELETE",
      body: JSON.stringify({ environmentId, keyToken: item.keyToken }),
    });
    await load(cursor);
  }
  if (!authorized)
    return (
      <EmptyState
        icon={<KeyRound />}
        title="Cache inspection restricted"
        description="Only project owners and admins can enumerate cache metadata or reveal redacted values."
      />
    );
  return (
    <section className="panel overflow-hidden">
      <div className="border-b p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Key prefix</label>
            <input
              className="field"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Tenant ID</label>
            <input
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
