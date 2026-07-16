"use client";

import { useMemo, useState } from "react";
import { Database, KeyRound, Plus, Search, Trash2 } from "lucide-react";
import { Badge, Button, Dialog, EmptyState } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { DataCollection, DataCollectionRecord, OpsFunction } from "@/lib/types";
import { NewCollectionVersion } from "./collection-editors";

type CollectionDetailProps = {
  collection: DataCollection;
  environmentId: string;
  functions: OpsFunction[];
  canDefine: boolean;
  canInspect: boolean;
  onChanged: () => void;
};

export function CollectionDetail(props: CollectionDetailProps) {
  const state = useCollectionDetailState(props);
  return (
    <div className="space-y-5">
      <CollectionOverview {...props} state={state} />
      <RecordsPanel {...props} state={state} />
      <RecordEditor state={state} />
    </div>
  );
}

function useCollectionDetailState({
  collection,
  environmentId,
  onChanged,
}: CollectionDetailProps) {
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

  const declaredFields = useMemo(() => collectionFields(collection), [collection]);
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
  return {
    tenantId,
    setTenantId,
    queryText,
    setQueryText,
    records,
    nextCursor,
    queryWarnings,
    message,
    recordOpen,
    setRecordOpen,
    recordText,
    setRecordText,
    editing,
    setEditing,
    busy,
    grantFunctionId,
    setGrantFunctionId,
    grantPermissions,
    setGrantPermissions,
    declaredFields,
    runQuery,
    saveRecord,
    remove,
    grant,
    revoke,
  };
}

function collectionFields(collection: DataCollection): string[] {
  return Object.keys(
    (collection.latestVersion?.schema.properties as Record<string, unknown>) ?? {},
  );
}

type DetailState = ReturnType<typeof useCollectionDetailState>;

function CollectionOverview({
  collection,
  functions,
  canDefine,
  canInspect,
  onChanged,
  state,
}: CollectionDetailProps & { state: DetailState }) {
  const {
    declaredFields,
    grantFunctionId,
    setGrantFunctionId,
    grantPermissions,
    setGrantPermissions,
    grant,
    revoke,
  } = state;
  return (
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
            <label className="label" htmlFor="collection-grant-function">
              Grant collection capabilities to Function
            </label>
            <select
              id="collection-grant-function"
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
  );
}

function RecordsPanel({
  canInspect,
  state,
}: CollectionDetailProps & { state: DetailState }) {
  const {
    tenantId,
    setTenantId,
    busy,
    runQuery,
    setEditing,
    setRecordText,
    setRecordOpen,
    queryText,
    setQueryText,
    message,
    queryWarnings,
    records,
    nextCursor,
    remove,
  } = state;
  return (
    <section className="panel overflow-hidden">
      <div className="border-b p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="collection-tenant-id">
              Tenant ID
            </label>
            <input
              id="collection-tenant-id"
              className="field w-56 font-mono"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
            />
          </div>
          <Button loading={busy} onClick={() => void runQuery()} disabled={!canInspect}>
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
        <label className="label mt-4" htmlFor="collection-query-dsl">
          Query DSL
        </label>
        <textarea
          id="collection-query-dsl"
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
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400" key={warning}>
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
  );
}

function RecordEditor({ state }: { state: DetailState }) {
  const {
    recordOpen,
    setRecordOpen,
    editing,
    recordText,
    setRecordText,
    busy,
    saveRecord,
  } = state;
  return (
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
      <Button className="mt-4 w-full" loading={busy} onClick={() => void saveRecord()}>
        Save record
      </Button>
    </Dialog>
  );
}
