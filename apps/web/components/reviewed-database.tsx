"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Ban,
  Database,
  FileCheck2,
  KeyRound,
  Link2,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { useToast } from "@/components/providers";
import { Badge, Button, Dialog, EmptyState, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type { RuntimeEndpointDetail } from "@/lib/types";

type Capabilities = {
  runtimeCapabilities?: { reviewedDatabaseQueries?: boolean };
};

type Connection = {
  id: string;
  environment: { id: string; name: string; slug: string };
  secret: { id: string; name: string };
  name: string;
  description: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  queryCount: number;
};

type QueryVersion = {
  id: string;
  version: number;
  sql?: string;
  parameterOrder: string[];
  parameterSchema: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
  timeoutMs: number;
  maxRows: number;
  maxBytes: number;
  enabled: boolean;
  createdAt: string;
};

type ReviewedQuery = {
  id: string;
  environmentId: string;
  connection: { id: string; name: string; enabled: boolean };
  queryId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  versions: QueryVersion[];
  grantCount: number;
};

type QueryGrant = {
  id: string;
  functionId: string;
  queryDefinitionId: string;
  queryVersionId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  query: {
    queryId: string;
    name: string;
    version: number;
    connection: { id: string; name: string; enabled: boolean };
    versionEnabled: boolean;
  };
};

export function ReviewedDatabaseQueries({
  endpoint,
}: {
  endpoint: RuntimeEndpointDetail;
}) {
  const user = useCurrentUser();
  const [capability, setCapability] = useState<boolean>();
  const [capabilityError, setCapabilityError] = useState<string>();
  const [connections, setConnections] = useState<Connection[]>();
  const [queries, setQueries] = useState<ReviewedQuery[]>();
  const [grants, setGrants] = useState<QueryGrant[]>();
  const [loadError, setLoadError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const authorized = roleAllows(user?.role, ["owner", "admin"]);

  useEffect(() => {
    api<Capabilities>("/api/capabilities")
      .then((result) =>
        setCapability(
          result.runtimeCapabilities?.reviewedDatabaseQueries === true,
        ),
      )
      .catch((error) => setCapabilityError(errorMessage(error)));
  }, []);

  const load = useCallback(() => {
    if (!authorized || capability !== true) return;
    setLoadError(undefined);
    const environmentId = encodeURIComponent(endpoint.environment.id);
    Promise.all([
      api<{ connections: Connection[] }>(
        `/api/database/connections?environmentId=${environmentId}`,
      ),
      api<{ queries: ReviewedQuery[] }>(
        `/api/database/queries?environmentId=${environmentId}`,
      ),
      Promise.all(
        endpoint.functions.map((fn) =>
          api<{ grants: QueryGrant[] }>(
            `/api/functions/${fn.id}/database-query-grants`,
          ),
        ),
      ),
    ])
      .then(([connectionResult, queryResult, grantResults]) => {
        setConnections(connectionResult.connections);
        setQueries(queryResult.queries);
        setGrants(grantResults.flatMap((result) => result.grants));
      })
      .catch((error) => setLoadError(errorMessage(error)));
  }, [
    authorized,
    capability,
    endpoint.environment.id,
    endpoint.functions,
    endpoint.id,
  ]);

  useEffect(load, [load, refresh]);
  const changed = () => setRefresh((value) => value + 1);

  if (capabilityError) {
    return (
      <FeatureState
        title="Reviewed database queries unavailable"
        description={`Capability status could not be verified: ${capabilityError}`}
        tone="warning"
      />
    );
  }
  if (capability === undefined || user === undefined) {
    return <Skeleton className="h-40 lg:col-span-2" />;
  }
  if (!capability) {
    return (
      <FeatureState
        title="Reviewed database queries disabled"
        description="This deployment has not enabled the reviewed database query capability. Functions cannot receive query grants while it is disabled."
        tone="neutral"
      />
    );
  }
  if (!authorized) {
    return (
      <FeatureState
        title="Reviewed database queries restricted"
        description="Only project owners and admins can view reviewed SQL, manage connection metadata, or grant exact query versions."
        tone="warning"
      />
    );
  }
  if (loadError) {
    return (
      <FeatureState
        title="Reviewed query configuration unavailable"
        description={loadError}
        tone="warning"
        action={
          <Button variant="secondary" size="sm" onClick={changed}>
            Retry
          </Button>
        }
      />
    );
  }
  if (!connections || !queries || !grants) {
    return <Skeleton className="h-64 lg:col-span-2" />;
  }

  return (
    <section className="panel overflow-hidden lg:col-span-2">
      <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileCheck2 size={17} className="text-primary" />
            <h2 className="text-sm font-semibold">Reviewed database queries</h2>
            <Badge tone="success">Enabled</Badge>
          </div>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">
            Owner/admin-reviewed, immutable SELECT contracts. Runtime functions
            receive only explicit query-version grants; connection values remain
            encrypted environment secrets.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ConnectionDialog endpoint={endpoint} onChanged={changed} />
          <QueryDialog
            endpoint={endpoint}
            connections={connections.filter((item) => item.enabled)}
            onChanged={changed}
          />
          <GrantDialog
            endpoint={endpoint}
            queries={queries}
            onChanged={changed}
          />
        </div>
      </div>
      <div className="grid gap-5 p-5 xl:grid-cols-[0.8fr_1.2fr]">
        <div>
          <h3 className="text-xs font-semibold">Connection metadata</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Secret values and connection strings are never returned.
          </p>
          <div className="mt-3 space-y-2">
            {connections.length ? (
              connections.map((connection) => (
                <ConnectionRow
                  key={connection.id}
                  connection={connection}
                  onChanged={changed}
                />
              ))
            ) : (
              <EmptyState
                icon={<Database />}
                title="No reviewed connections"
                description="Create metadata that references an existing encrypted environment secret."
              />
            )}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-semibold">Immutable query versions</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            SQL is visible here only to authenticated owners and admins. It is
            never returned to runtime callers.
          </p>
          <div className="mt-3 space-y-3">
            {queries.length ? (
              queries.map((query) => (
                <QueryCard
                  key={query.id}
                  query={query}
                  grants={grants.filter(
                    (grant) => grant.queryDefinitionId === query.id,
                  )}
                  endpoint={endpoint}
                  onChanged={changed}
                />
              ))
            ) : (
              <EmptyState
                icon={<FileCheck2 />}
                title="No reviewed queries"
                description="Create a bounded read-only SELECT contract after adding a connection."
              />
            )}
          </div>
        </div>
      </div>
      <div className="border-t bg-muted/20 px-5 py-3 text-[10px] leading-5 text-muted-foreground">
        No raw SQL is exposed in the function editor or runtime context. Query
        definitions are reviewed control-plane resources and grants target one
        exact immutable version.
      </div>
    </section>
  );
}

function FeatureState({
  title,
  description,
  tone,
  action,
}: {
  title: string;
  description: string;
  tone: "neutral" | "warning";
  action?: React.ReactNode;
}) {
  return (
    <section className="panel p-5 lg:col-span-2">
      <div className="flex items-start gap-3">
        <span
          className={
            tone === "warning"
              ? "rounded-lg bg-amber-500/10 p-2 text-amber-500"
              : "rounded-lg bg-muted p-2 text-muted-foreground"
          }
        >
          <ShieldAlert size={17} />
        </span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
            {description}
          </p>
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </section>
  );
}

function ConnectionRow({
  connection,
  onChanged,
}: {
  connection: Connection;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  async function disable() {
    setSaving(true);
    try {
      await api(`/api/database/connections/${connection.id}/disable`, {
        method: "POST",
        body: "{}",
      });
      toast({
        title: `${connection.name} disabled`,
        description: "New query use is blocked; existing metadata is retained.",
        tone: "success",
      });
      onChanged();
    } catch (error) {
      toast({
        title: "Connection could not be disabled",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-xs font-medium">
              {connection.name}
            </span>
            <Badge tone={connection.enabled ? "success" : "neutral"}>
              {connection.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {connection.description || "No description"}
          </p>
        </div>
        {connection.enabled && (
          <Button
            variant="ghost"
            size="icon"
            loading={saving}
            onClick={disable}
            aria-label={`Disable ${connection.name}`}
          >
            <Ban size={14} />
          </Button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        <Badge>
          <KeyRound size={10} />
          {connection.secret.name}
        </Badge>
        <Badge>{connection.environment.slug}</Badge>
        <Badge>{connection.queryCount} queries</Badge>
      </div>
    </div>
  );
}

function ConnectionDialog({
  endpoint,
  onChanged,
}: {
  endpoint: RuntimeEndpointDetail;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [secretId, setSecretId] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string>();
  const environmentSecrets = endpoint.secrets.filter(
    (secret) =>
      secret.environment === endpoint.environment.name ||
      secret.environment === endpoint.environment.slug,
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(undefined);
    try {
      await api("/api/database/connections", {
        method: "POST",
        body: JSON.stringify({
          environmentId: endpoint.environment.id,
          secretId,
          name,
          description,
        }),
      });
      toast({
        title: "Connection metadata created",
        description: "Only the encrypted secret reference was stored.",
        tone: "success",
      });
      setOpen(false);
      setName("");
      setDescription("");
      setSecretId("");
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
        <Button variant="secondary" size="sm">
          <Plus size={13} />
          Connection
        </Button>
      }
      title="Create reviewed connection metadata"
      description="Select an existing encrypted environment secret. Connection plaintext is never accepted or displayed."
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Name</label>
          <input
            className="field font-mono"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="analytics_readonly"
          />
        </div>
        <div>
          <label className="label">Environment secret</label>
          <select
            className="field"
            value={secretId}
            onChange={(event) => setSecretId(event.target.value)}
          >
            <option value="">Select an encrypted secret</option>
            {environmentSecrets.map((secret) => (
              <option value={secret.id} key={secret.id}>
                {secret.name} · {secret.environment}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {environmentSecrets.length
              ? `Only ${endpoint.environment.name} secrets are selectable. Their values are never loaded into this form.`
              : `Create a secret in ${endpoint.environment.name} before adding connection metadata.`}
          </p>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea
            className="field min-h-20"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        {formError && <FormError message={formError} />}
        <div className="flex justify-end">
          <Button loading={saving} disabled={!name || !secretId}>
            Create metadata
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function QueryCard({
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
              <span className="font-mono text-xs font-medium">
                {query.queryId}
              </span>
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
            <QueryVersionRow
              key={version.id}
              version={version}
              onChanged={onChanged}
            />
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

function QueryVersionRow({
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

function QueryDialog({
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
    latest?.sql ??
      "SELECT id, name FROM customers WHERE tenant_id = $1 LIMIT $2",
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
        query
          ? `/api/database/queries/${query.id}/versions`
          : "/api/database/queries",
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
        title: query
          ? "Immutable query version created"
          : "Reviewed query created",
        description:
          "The server validated one bounded read-only PostgreSQL SELECT.",
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
            disabled={
              !sql.trim() || (!query && (!connectionId || !queryId || !name))
            }
          >
            Create immutable version
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function GrantDialog({
  endpoint,
  queries,
  onChanged,
}: {
  endpoint: RuntimeEndpointDetail;
  queries: ReviewedQuery[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const versions = useMemo(
    () =>
      queries.flatMap((query) =>
        query.connection.enabled
          ? query.versions
              .filter((version) => version.enabled)
              .map((version) => ({ ...version, query }))
          : [],
      ),
    [queries],
  );
  const [open, setOpen] = useState(false);
  const [functionId, setFunctionId] = useState(endpoint.functions[0]?.id ?? "");
  const [queryVersionId, setQueryVersionId] = useState(versions[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string>();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(undefined);
    try {
      await api(`/api/functions/${functionId}/database-query-grants`, {
        method: "POST",
        body: JSON.stringify({ queryVersionId }),
      });
      toast({
        title: "Exact query version granted",
        description: "The function cannot execute other queries or versions.",
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
          size="sm"
          disabled={!endpoint.functions.length || !versions.length}
        >
          <Link2 size={13} />
          Grant
        </Button>
      }
      title="Grant an exact query version"
      description="A function receives capability access to this version only. No raw SQL or connection credential is exposed."
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Function</label>
          <select
            className="field"
            value={functionId}
            onChange={(event) => setFunctionId(event.target.value)}
          >
            {endpoint.functions.map((fn) => (
              <option value={fn.id} key={fn.id}>
                {fn.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Reviewed version</label>
          <select
            className="field"
            value={queryVersionId}
            onChange={(event) => setQueryVersionId(event.target.value)}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.query.queryId} · version {version.version} ·{" "}
                {version.query.connection.name}
              </option>
            ))}
          </select>
        </div>
        {formError && <FormError message={formError} />}
        <div className="flex justify-end">
          <Button loading={saving} disabled={!functionId || !queryVersionId}>
            Grant exact version
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function GrantRow({
  grant,
  endpoint,
  onChanged,
}: {
  grant: QueryGrant;
  endpoint: RuntimeEndpointDetail;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const fn = endpoint.functions.find((item) => item.id === grant.functionId);
  async function revoke() {
    setSaving(true);
    try {
      await api(
        `/api/functions/${grant.functionId}/database-query-grants/${grant.id}`,
        { method: "DELETE" },
      );
      toast({ title: "Query grant revoked", tone: "success" });
      onChanged();
    } catch (error) {
      toast({
        title: "Grant could not be revoked",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded border bg-card p-2.5">
      <div>
        <p className="font-mono text-[11px]">
          {fn?.name ?? "Unknown function"}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Exact version {grant.query.version}
          {!grant.query.versionEnabled || !grant.query.connection.enabled
            ? " · source disabled"
            : ""}
        </p>
      </div>
      <Button variant="ghost" size="sm" loading={saving} onClick={revoke}>
        Revoke
      </Button>
    </div>
  );
}

function SchemaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <textarea
        className="field min-h-24 font-mono text-[11px]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="field"
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
function JsonSummary({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="rounded border bg-card p-2">
      <summary className="cursor-pointer text-[10px] font-medium">
        {label}
      </summary>
      <pre className="mt-2 max-h-32 overflow-auto font-mono text-[9px] leading-4 text-muted-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
function FormError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
      {message}
    </div>
  );
}
function parseObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object`);
  return parsed as Record<string, unknown>;
}
function formatBytes(value: number) {
  return value >= 1_048_576
    ? `${(value / 1_048_576).toFixed(1)} MiB`
    : `${Math.round(value / 1024)} KiB`;
}
