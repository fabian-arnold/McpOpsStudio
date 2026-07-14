"use client";
import { type FormEvent, useState } from "react";
import { Ban, Plus } from "lucide-react";
import { useToast } from "@/components/providers";
import { Badge, Button, Dialog } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { RuntimeEndpointDetail } from "@/lib/types";
import type {
  Connection,
  QueryGrant,
  QueryVersion,
  ReviewedQuery,
} from "./reviewed-database-types";
import { GrantRow } from "./reviewed-database-grants";
import {
  FormError,
  JsonSummary,
  NumberField,
  SchemaField,
  formatBytes,
  parseObject,
} from "./reviewed-database-fields";

export function QueryCard({
  query,
  grants,
  endpoint,
  onChanged,
}: {
  query: ReviewedQuery;
  grants: QueryGrant[];
  endpoint: RuntimeEndpointDetail;
  onChanged: () => void;
}) {
  const latest = [...query.versions].sort(
    (left, right) => right.version - left.version,
  )[0];
  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer list-none p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-medium">{query.queryId}</span>
              <Badge>{query.connection.name}</Badge>
              <Badge tone={latest?.enabled ? "success" : "neutral"}>
                v{latest?.version ?? 0}
              </Badge>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {query.name} · {query.grantCount} grants · {query.versions.length}{" "}
              immutable versions
            </p>
          </div>
          <QueryDialog
            endpoint={endpoint}
            connections={[]}
            query={query}
            onChanged={onChanged}
          />
        </div>
      </summary>
      <div className="space-y-3 border-t p-3">
        {[...query.versions]
          .sort((left, right) => right.version - left.version)
          .map((version) => (
            <QueryVersionRow key={version.id} version={version} onChanged={onChanged} />
          ))}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Function grants
          </p>
          <div className="mt-2 space-y-2">
            {grants.filter((grant) => grant.enabled).length ? (
              grants
                .filter((grant) => grant.enabled)
                .map((grant) => (
                  <GrantRow
                    key={grant.id}
                    grant={grant}
                    endpoint={endpoint}
                    onChanged={onChanged}
                  />
                ))
            ) : (
              <p className="rounded border border-dashed p-3 text-[11px] text-muted-foreground">
                No active function grants.
              </p>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}

export function QueryVersionRow({
  version,
  onChanged,
}: {
  version: QueryVersion;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  async function disable() {
    setSaving(true);
    try {
      await api(`/api/database/query-versions/${version.id}/disable`, {
        method: "POST",
        body: "{}",
      });
      toast({
        title: `Query version ${version.version} disabled`,
        tone: "success",
      });
      onChanged();
    } catch (error) {
      toast({
        title: "Query version could not be disabled",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="rounded-lg bg-muted/35 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={version.enabled ? "success" : "neutral"}>
            Version {version.version}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {version.timeoutMs} ms · {version.maxRows} rows ·{" "}
            {formatBytes(version.maxBytes)}
          </span>
        </div>
        {version.enabled && (
          <Button variant="ghost" size="sm" loading={saving} onClick={disable}>
            <Ban size={12} />
            Disable
          </Button>
        )}
      </div>
      <pre className="mt-3 max-h-48 overflow-auto rounded bg-[#0b0d14] p-3 font-mono text-[10px] leading-5 text-slate-300">
        {version.sql ?? "SQL was not returned by the authorized API."}
      </pre>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <JsonSummary label="Parameter order" value={version.parameterOrder} />
        <JsonSummary label="Parameter schema" value={version.parameterSchema} />
        {version.resultSchema && (
          <JsonSummary label="Result schema" value={version.resultSchema} />
        )}
      </div>
    </div>
  );
}

export function QueryDialog({
  endpoint,
  connections,
  query,
  onChanged,
}: {
  endpoint: RuntimeEndpointDetail;
  connections: Connection[];
  query?: ReviewedQuery;
  onChanged: () => void;
}) {
  const toast = useToast();
  const latest = query
    ? [...query.versions].sort((left, right) => right.version - left.version)[0]
    : undefined;
  const [open, setOpen] = useState(false);
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const [queryId, setQueryId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sql, setSql] = useState(
    latest?.sql ?? "SELECT id, name FROM customers WHERE tenant_id = $1 LIMIT $2",
  );
  const [parameterOrder, setParameterOrder] = useState(
    latest?.parameterOrder.join(", ") ?? "tenant_id, limit",
  );
  const [parameterSchema, setParameterSchema] = useState(
    JSON.stringify(
      latest?.parameterSchema ?? {
        type: "object",
        properties: {
          tenant_id: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["tenant_id", "limit"],
        additionalProperties: false,
      },
      null,
      2,
    ),
  );
  const [resultSchema, setResultSchema] = useState(
    latest?.resultSchema ? JSON.stringify(latest.resultSchema, null, 2) : "",
  );
  const [timeoutMs, setTimeoutMs] = useState(latest?.timeoutMs ?? 5000);
  const [maxRows, setMaxRows] = useState(latest?.maxRows ?? 100);
  const [maxBytes, setMaxBytes] = useState(latest?.maxBytes ?? 1_048_576);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string>();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(undefined);
    try {
      const versionContract = {
        sql,
        parameterOrder: parameterOrder
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        parameterSchema: parseObject(parameterSchema, "Parameter schema"),
        ...(resultSchema.trim()
          ? { resultSchema: parseObject(resultSchema, "Result schema") }
          : {}),
        timeoutMs,
        maxRows,
        maxBytes,
        enabled: true,
      };
      await api(
        query ? `/api/database/queries/${query.id}/versions` : "/api/database/queries",
        {
          method: "POST",
          body: JSON.stringify(
            query
              ? versionContract
              : {
                  environmentId: endpoint.environment.id,
                  connectionId,
                  queryId,
                  name,
                  description,
                  ...versionContract,
                },
          ),
        },
      );
      toast({
        title: query ? "Immutable query version created" : "Reviewed query created",
        description: "The server validated one bounded read-only PostgreSQL SELECT.",
        tone: "success",
      });
      setOpen(false);
      onChanged();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          variant="secondary"
          size="sm"
          disabled={!query && connections.length === 0}
          title={
            !query && connections.length === 0
              ? "Create an enabled connection first"
              : undefined
          }
        >
          <Plus size={13} />
          {query ? "New version" : "Query"}
        </Button>
      }
      title={
        query
          ? `Create immutable ${query.queryId} version`
          : "Create reviewed SELECT query"
      }
      description="Only one read-only PostgreSQL SELECT is accepted. SQL and execution bounds become immutable after creation."
    >
      <form onSubmit={submit} className="space-y-4">
        {!query && (
          <>
            <div>
              <label className="label">Connection</label>
              <select
                className="field"
                value={connectionId}
                onChange={(event) => setConnectionId(event.target.value)}
              >
                <option value="">Select an enabled connection</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Query ID</label>
                <input
                  className="field font-mono"
                  value={queryId}
                  onChange={(event) => setQueryId(event.target.value)}
                  placeholder="customers_search"
                />
              </div>
              <div>
                <label className="label">Display name</label>
                <input
                  className="field"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="label">Description</label>
              <input
                className="field"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </>
        )}
        <div>
          <label className="label">Reviewed SELECT</label>
          <textarea
            className="field min-h-28 font-mono text-xs"
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            spellCheck={false}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Use positional parameters $1…$N matching the order below. DDL, DML,
            transactions, row locks, and unsafe functions are rejected.
          </p>
        </div>
        <div>
          <label className="label">Parameter order</label>
          <input
            className="field font-mono"
            value={parameterOrder}
            onChange={(event) => setParameterOrder(event.target.value)}
            placeholder="tenant_id, limit"
          />
        </div>
        <SchemaField
          label="Parameter JSON Schema"
          value={parameterSchema}
          onChange={setParameterSchema}
        />
        <SchemaField
          label="Result JSON Schema (optional)"
          value={resultSchema}
          onChange={setResultSchema}
        />
        <div className="grid grid-cols-3 gap-3">
          <NumberField
            label="Timeout (ms)"
            value={timeoutMs}
            onChange={setTimeoutMs}
            min={100}
            max={30000}
          />
          <NumberField
            label="Max rows"
            value={maxRows}
            onChange={setMaxRows}
            min={1}
            max={10000}
          />
          <NumberField
            label="Max bytes"
            value={maxBytes}
            onChange={setMaxBytes}
            min={1024}
            max={10485760}
          />
        </div>
        {formError && <FormError message={formError} />}
        <div className="flex justify-end">
          <Button
            loading={saving}
            disabled={!sql.trim() || (!query && (!connectionId || !queryId || !name))}
          >
            Create immutable version
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
