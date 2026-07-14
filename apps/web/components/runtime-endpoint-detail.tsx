"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Boxes,
  Code2,
  FileJson,
  KeyRound,
  Plus,
  Route,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  LoadError,
  PageHeader,
  Skeleton,
  StatusDot,
} from "@/components/ui";
import { useToast } from "@/components/providers";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type {
  HttpBinding,
  McpBinding,
  RuntimeEndpointDetail,
} from "@/lib/types";
import { EnvironmentEndpointUrls } from "@/components/environment-endpoint-urls";

type EndpointKind = "mcp" | "http";
type Tab =
  | "overview"
  | "bindings"
  | "authentication"
  | "network"
  | "executions"
  | "manifest"
  | "settings";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "bindings", label: "Bindings" },
  { id: "authentication", label: "Authentication" },
  { id: "network", label: "Network" },
  { id: "executions", label: "Executions" },
  { id: "manifest", label: "Manifest" },
  { id: "settings", label: "Settings" },
];

export function RuntimeEndpointDetailPage({ kind }: { kind: EndpointKind }) {
  const { endpointId } = useParams<{ endpointId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const [endpoint, setEndpoint] = useState<RuntimeEndpointDetail>();
  const [error, setError] = useState<string>();
  const tab = (tabs.some((item) => item.id === search.get("tab"))
    ? search.get("tab")
    : "overview") as Tab;
  const basePath = kind === "mcp" ? "/mcp-endpoints" : "/http-apis";
  const label = kind === "mcp" ? "MCP Endpoint" : "HTTP API";

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const value = await api<RuntimeEndpointDetail>(
        `/api/runtime-endpoints/${endpointId}`,
      );
      if (value.kind !== kind)
        throw new Error(`This endpoint is not an ${label}.`);
      setEndpoint(value);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [endpointId, kind, label]);
  useEffect(() => void load(), [load]);

  function selectTab(next: Tab) {
    router.replace(`${basePath}/${endpointId}?tab=${next}`, { scroll: false });
  }

  if (error)
    return (
      <AppShell>
        <LoadError message={error} onRetry={() => void load()} />
      </AppShell>
    );
  if (!endpoint)
    return (
      <AppShell>
        <Skeleton className="h-[70vh]" />
      </AppShell>
    );

  return (
    <AppShell>
      <Link
        href={basePath}
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={13} /> {kind === "mcp" ? "MCP Endpoints" : "HTTP APIs"}
      </Link>
      <PageHeader
        eyebrow={label}
        title={endpoint.name}
        description={endpoint.description}
        actions={
          <>
            <Badge tone={endpoint.status === "deployed" ? "success" : "neutral"}>
              <StatusDot status={endpoint.status} /> {endpoint.status}
            </Badge>
          </>
        }
      />
      <div className="mb-6 overflow-x-auto border-b">
        <div className="flex min-w-max gap-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => selectTab(item.id)}
              className={cn(
                "relative px-3 py-3 text-xs font-medium",
                tab === item.id
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              {tab === item.id && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-primary" />
              )}
            </button>
          ))}
        </div>
      </div>
      {tab === "overview" && <Overview endpoint={endpoint} kind={kind} />}
      {tab === "bindings" && (
        <Bindings endpoint={endpoint} kind={kind} onChanged={load} />
      )}
      {tab === "authentication" && (
        <Authentication endpoint={endpoint} onChanged={load} />
      )}
      {tab === "network" && <NetworkPolicy endpoint={endpoint} onChanged={load} />}
      {tab === "executions" && <Executions endpoint={endpoint} />}
      {tab === "manifest" && <Manifest endpoint={endpoint} />}
      {tab === "settings" && <Settings endpoint={endpoint} onChanged={load} />}
    </AppShell>
  );
}

function Overview({ endpoint, kind }: { endpoint: RuntimeEndpointDetail; kind: EndpointKind }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<Boxes size={15} />} label="Active deployment" value={endpoint.activeDeployment ? `v${endpoint.activeDeployment.version}` : "None"} />
        <Stat icon={<Code2 size={15} />} label="Bound Functions" value={endpoint.functionCount} />
        <Stat icon={<Activity size={15} />} label="Calls · 24h" value={endpoint.telemetry?.calls ?? 0} />
        <Stat icon={<ShieldCheck size={15} />} label="Authentication" value={endpoint.authMode} />
      </div>
      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Public endpoint</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Traffic is served only from the active immutable deployment.
        </p>
        <EnvironmentEndpointUrls
          className="mt-4"
          kind={kind}
          urls={endpoint.environmentEndpoints}
          fallback={endpoint.endpoints}
        />
      </section>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{label}</span>{icon}</div>
      <p className="mt-3 text-xl font-semibold">{value}</p>
    </div>
  );
}

function Bindings({ endpoint, kind, onChanged }: { endpoint: RuntimeEndpointDetail; kind: EndpointKind; onChanged: () => Promise<void> }) {
  const bindings = kind === "mcp" ? endpoint.mcpBindings : endpoint.httpBindings;
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b p-4">
        <div>
          <h2 className="text-sm font-semibold">{kind === "mcp" ? "MCP tools" : "HTTP routes"}</h2>
          <p className="mt-1 text-xs text-muted-foreground">Every binding selects a reusable project Function.</p>
        </div>
        <BindingDialog endpoint={endpoint} kind={kind} onSaved={onChanged} />
      </div>
      {!bindings.length ? (
        <EmptyState icon={kind === "mcp" ? <TerminalSquare /> : <Route />} title="No bindings" description="Assign a project Function to expose it from this endpoint." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-muted/30 text-muted-foreground"><tr><th className="p-3">Exposure</th><th className="p-3">Function</th><th className="p-3">Status</th><th className="p-3 text-right">Action</th></tr></thead>
            <tbody>
              {bindings.map((binding) => {
                const fn = endpoint.functions.find((item) => item.id === binding.functionId);
                const exposure = kind === "mcp" ? (binding as McpBinding).toolName : `${(binding as HttpBinding).method} ${(binding as HttpBinding).path}`;
                return <tr key={binding.id} className="border-b last:border-0"><td className="p-3 font-mono">{exposure}</td><td className="p-3"><Link className="hover:text-primary" href={`/functions/${binding.functionId}`}>{fn?.name ?? "Unknown"}</Link></td><td className="p-3"><Badge tone={binding.enabled ? "success" : "neutral"}>{binding.enabled ? "enabled" : "disabled"}</Badge></td><td className="p-3 text-right"><DeleteBinding endpointId={endpoint.id} kind={kind} bindingId={binding.id} onDeleted={onChanged} /></td></tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BindingDialog({ endpoint, kind, onSaved }: { endpoint: RuntimeEndpointDetail; kind: EndpointKind; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [functionId, setFunctionId] = useState(endpoint.functions[0]?.id ?? "");
  const [name, setName] = useState("");
  const [method, setMethod] = useState("GET");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function save() {
    setBusy(true); setError(undefined);
    try {
      await api(`/api/runtime-endpoints/${endpoint.id}/${kind === "mcp" ? "mcp-bindings" : "http-bindings"}`, {
        method: "POST",
        body: JSON.stringify(kind === "mcp" ? { functionId, toolName: name, title: name, description: `Invoke ${name}`, enabled: true } : { functionId, method, path: name, inputMapping: null, responseMapping: null, enabled: true }),
      });
      setOpen(false); setName(""); await onSaved();
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={setOpen} trigger={<Button size="sm"><Plus size={14} /> Add {kind === "mcp" ? "tool" : "route"}</Button>} title={`Add ${kind === "mcp" ? "MCP tool" : "HTTP route"}`} description="Bind a reusable project Function.">
    <div className="space-y-4">
      <div><label className="label">Function</label><select className="field" value={functionId} onChange={(event) => setFunctionId(event.target.value)}>{endpoint.functions.map((fn) => <option key={fn.id} value={fn.id}>{fn.name}</option>)}</select></div>
      {kind === "http" && <div><label className="label">Method</label><select className="field" value={method} onChange={(event) => setMethod(event.target.value)}>{["GET","POST","PUT","PATCH","DELETE"].map((value) => <option key={value}>{value}</option>)}</select></div>}
      <div><label className="label">{kind === "mcp" ? "Tool name" : "Route path"}</label><input className="field font-mono" value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "mcp" ? "search_customers" : "/v1/customers/search"} /></div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <Button loading={busy} disabled={!functionId || !name} onClick={() => void save()}>Save binding</Button>
    </div>
  </Dialog>;
}

function DeleteBinding({ endpointId, kind, bindingId, onDeleted }: { endpointId: string; kind: EndpointKind; bindingId: string; onDeleted: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function remove() { setBusy(true); try { await api(`/api/runtime-endpoints/${endpointId}/${kind === "mcp" ? "mcp-bindings" : "http-bindings"}/${bindingId}`, { method: "DELETE" }); await onDeleted(); } finally { setBusy(false); } }
  return <Button variant="ghost" size="icon" loading={busy} onClick={() => void remove()} aria-label="Delete binding"><Trash2 size={14} /></Button>;
}

function Authentication({ endpoint, onChanged }: { endpoint: RuntimeEndpointDetail; onChanged: () => Promise<void> }) {
  const user = useCurrentUser();
  const canManage = roleAllows(user?.role, ["owner", "admin"]);
  const toast = useToast();
  const [busyId, setBusyId] = useState<string>();
  const assigned = [...(endpoint.assignedAuthPolicies ?? [])].sort(
    (left, right) => left.position - right.position,
  );
  const assignedIds = new Set(assigned.map((policy) => policy.id));
  const available = endpoint.authPolicies.filter(
    (policy) => !assignedIds.has(policy.id),
  );

  async function reorder(index: number, offset: -1 | 1) {
    const next = [...assigned];
    const target = index + offset;
    if (!next[index] || !next[target]) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBusyId(next[target].id);
    try {
      await api(`/api/runtime-endpoints/${endpoint.id}/auth-policies/order`, {
        method: "PUT",
        body: JSON.stringify({ policyIds: next.map((policy) => policy.id) }),
      });
      await onChanged();
    } catch (reason) {
      toast({
        title: "Policy order was not changed",
        description: errorMessage(reason),
        tone: "error",
      });
    } finally {
      setBusyId(undefined);
    }
  }

  async function remove(policyId: string) {
    setBusyId(policyId);
    try {
      await api(
        `/api/runtime-endpoints/${endpoint.id}/auth-policies/${policyId}`,
        { method: "DELETE" },
      );
      toast({
        title: "Authentication policy removed",
        description: "Deploy the Project to publish this change.",
        tone: "success",
      });
      await onChanged();
    } catch (reason) {
      toast({
        title: "Policy was not removed",
        description: errorMessage(reason),
        tone: "error",
      });
    } finally {
      setBusyId(undefined);
    }
  }

  async function assign(policyId: string) {
    setBusyId(policyId);
    try {
      await api(
        `/api/runtime-endpoints/${endpoint.id}/auth-policies/${policyId}/default`,
        { method: "POST", body: "{}" },
      );
      await onChanged();
    } catch (reason) {
      toast({
        title: "Policy was not added",
        description: errorMessage(reason),
        tone: "error",
      });
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <div>
          <h2 className="text-sm font-semibold">Endpoint authentication</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Policies are checked from top to bottom until one authenticates the
            request.
          </p>
        </div>
        {canManage && (
          <CreateAuthPolicy endpoint={endpoint} onSaved={onChanged} />
        )}
      </div>
      {!assigned.length ? (
        <EmptyState
          icon={<KeyRound />}
          title="No authentication policy"
          description="Add at least one authentication policy before deploying this endpoint."
          action={
            canManage ? (
              <CreateAuthPolicy endpoint={endpoint} onSaved={onChanged} />
            ) : undefined
          }
        />
      ) : (
        <div className="divide-y">
          {assigned.map((policy, index) => (
            <div key={policy.id} className="flex items-center gap-3 p-4">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted font-mono text-xs">
                {index + 1}
              </span>
              <KeyRound size={15} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{policy.name}</p>
                <p className="text-xs capitalize text-muted-foreground">
                  {policy.type.replaceAll("_", " ")}
                </p>
              </div>
              {index === 0 && <Badge tone="success">Checked first</Badge>}
              {canManage && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={index === 0 || Boolean(busyId)}
                    onClick={() => void reorder(index, -1)}
                    aria-label={`Move ${policy.name} up`}
                  >
                    <ArrowUp size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={index === assigned.length - 1 || Boolean(busyId)}
                    onClick={() => void reorder(index, 1)}
                    aria-label={`Move ${policy.name} down`}
                  >
                    <ArrowDown size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-red-500"
                    loading={busyId === policy.id}
                    disabled={Boolean(busyId)}
                    onClick={() => void remove(policy.id)}
                    aria-label={`Remove ${policy.name}`}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <div className="border-t bg-muted/20 p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Available project policies
          </p>
          <div className="flex flex-wrap gap-2">
            {available.map((policy) => (
              <Button
                key={policy.id}
                size="sm"
                variant="secondary"
                loading={busyId === policy.id}
                disabled={!canManage || Boolean(busyId)}
                onClick={() => void assign(policy.id)}
              >
                <Plus size={13} /> {policy.name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function CreateAuthPolicy({ endpoint, onSaved }: { endpoint: RuntimeEndpointDetail; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"public" | "api_key" | "bearer_token" | "basic_auth">("api_key");
  const [name, setName] = useState("");
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [username, setUsername] = useState("");
  const [permissions, setPermissions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const toast = useToast();
  const existingSecret = endpoint.secrets.some((secret) => secret.name === secretName);
  async function save() {
    setBusy(true); setError(undefined);
    try {
      if (type !== "public" && !existingSecret && !secretValue) throw new Error("Enter a credential value for the new Secret.");
      if (type !== "public" && !existingSecret)
        await api("/api/secrets", {
          method: "POST",
          body: JSON.stringify({ environmentId: endpoint.environment.id, name: secretName, value: secretValue }),
        });
      const permissionList = permissions.split(",").map((value) => value.trim()).filter(Boolean);
      const config = type === "public"
        ? { permissions: permissionList }
        : type === "api_key"
          ? { header: "x-api-key", secretRef: secretName, permissions: permissionList }
        : type === "bearer_token"
          ? { header: "authorization", scheme: "Bearer", secretRef: secretName, permissions: permissionList }
          : { header: "authorization", scheme: "Basic", username, secretRef: secretName, permissions: permissionList };
      await api(`/api/runtime-endpoints/${endpoint.id}/auth-policies`, {
        method: "POST",
        body: JSON.stringify({ name, type, config }),
      });
      setOpen(false); setSecretValue("");
      toast({ title: "Authentication policy created", description: "The policy was added last in the authentication order. Deploy the Project to publish it.", tone: "success" });
      await onSaved();
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={setOpen} trigger={<Button size="sm"><Plus size={14} /> Add authentication</Button>} title="Add endpoint authentication" description="Create and append an authentication policy to this endpoint."><div className="space-y-4"><div><label className="label">Authentication type</label><select className="field" value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="public">Public (no authentication)</option><option value="api_key">API key</option><option value="bearer_token">Bearer token</option><option value="basic_auth">HTTP Basic</option></select></div>{type === "public" && <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">Anyone who can reach this endpoint can list or invoke bindings allowed by the permissions below. A public policy makes every policy below it unreachable.</p>}<div><label className="label">Policy name</label><input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder={type === "public" ? "Public access" : "Agent access"} /></div>{type === "basic_auth" && <div><label className="label">Username</label><input className="field" value={username} onChange={(event) => setUsername(event.target.value)} /></div>}{type !== "public" && <><div><label className="label">Credential Secret name</label><input className="field font-mono" list={`auth-secrets-${endpoint.id}`} value={secretName} onChange={(event) => setSecretName(event.target.value.toUpperCase())} placeholder="MCP_CLIENT_API_KEY" /><datalist id={`auth-secrets-${endpoint.id}`}>{endpoint.secrets.map((secret) => <option key={secret.id} value={secret.name} />)}</datalist><p className="mt-1 text-[10px] text-muted-foreground">Select an existing environment Secret or enter a new uppercase name.</p></div><div><label className="label">{existingSecret ? "Credential value (already stored)" : "Credential value"}</label><input className="field" type="password" value={secretValue} disabled={existingSecret} onChange={(event) => setSecretValue(event.target.value)} placeholder={existingSecret ? "Existing Secret will be used" : "Stored encrypted and never shown again"} /></div></>}<div><label className="label">Granted Function permissions</label><input className="field font-mono" value={permissions} onChange={(event) => setPermissions(event.target.value)} placeholder="customers.read, customers.write" /></div>{error && <p className="text-xs text-red-500">{error}</p>}<Button loading={busy} disabled={!name || (type !== "public" && !secretName) || (type === "basic_auth" && !username)} onClick={() => void save()}>Create and add policy</Button></div></Dialog>;
}

function NetworkPolicy({ endpoint, onChanged }: { endpoint: RuntimeEndpointDetail; onChanged: () => Promise<void> }) {
  const policy = endpoint.networkPolicy as RuntimeEndpointDetail["networkPolicy"] & { allowedPorts?: number[]; allowPrivateHosts?: string[]; maxResponseBytes?: number };
  const [hosts, setHosts] = useState((policy.allowedHosts ?? []).join("\n"));
  const [methods, setMethods] = useState((policy.allowedMethods ?? ["GET"]).join(", "));
  const [busy, setBusy] = useState(false);
  async function save() { setBusy(true); try { await api(`/api/runtime-endpoints/${endpoint.id}/network-policy`, { method: "PUT", body: JSON.stringify({ allowedHosts: hosts.split(/\s+/).filter(Boolean), allowedMethods: methods.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean), allowedPorts: policy.allowedPorts ?? [443], allowPrivateHosts: policy.allowPrivateHosts ?? [], maxResponseBytes: policy.maxResponseBytes ?? 1048576 }) }); await onChanged(); } finally { setBusy(false); } }
  return <section className="panel p-5"><h2 className="text-sm font-semibold">Outbound network policy</h2><p className="mt-1 text-xs text-muted-foreground">The policy is endpoint-specific even when Functions are reused elsewhere.</p><div className="mt-5 grid gap-4 md:grid-cols-2"><div><label className="label">Allowed hosts · one per line</label><textarea className="field min-h-36 font-mono" value={hosts} onChange={(event) => setHosts(event.target.value)} /></div><div><label className="label">Allowed methods · comma separated</label><input className="field font-mono" value={methods} onChange={(event) => setMethods(event.target.value)} /></div></div><Button className="mt-4" loading={busy} onClick={() => void save()}>Save network policy</Button></section>;
}

function Executions({ endpoint }: { endpoint: RuntimeEndpointDetail }) {
  return <section className="panel overflow-hidden"><div className="border-b p-4"><h2 className="text-sm font-semibold">Recent executions</h2></div>{!endpoint.executions.length ? <EmptyState icon={<Activity />} title="No executions" description="Calls through this endpoint will appear here." /> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-b bg-muted/30"><tr><th className="p-3">Time</th><th className="p-3">Function</th><th className="p-3">Version</th><th className="p-3">Source</th><th className="p-3">Status</th><th className="p-3">Latency</th></tr></thead><tbody>{endpoint.executions.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="p-3">{new Date(item.createdAt).toLocaleString()}</td><td className="p-3 font-mono">{item.functionName}</td><td className="p-3">v{item.functionVersion}</td><td className="p-3">{item.invocationSource}</td><td className="p-3"><Badge tone={item.status === "success" ? "success" : "danger"}>{item.status}</Badge></td><td className="p-3">{item.durationMs} ms</td></tr>)}</tbody></table></div>}</section>;
}

function Manifest({ endpoint }: { endpoint: RuntimeEndpointDetail }) {
  const [content, setContent] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string>();
  useEffect(() => { api<{ content: string }>(`/api/runtime-endpoints/${endpoint.id}/manifest?format=yaml`).then((value) => setContent(value.content)).catch((reason) => setMessage(errorMessage(reason))); }, [endpoint.id]);
  async function apply() { setBusy(true); setMessage(undefined); try { await api(`/api/runtime-endpoints/${endpoint.id}/manifest`, { method: "POST", body: JSON.stringify({ format: "yaml", content, apply: true }) }); setMessage("Manifest applied."); } catch (reason) { setMessage(errorMessage(reason)); } finally { setBusy(false); } }
  return <section className="panel p-5"><div className="flex items-center gap-2"><FileJson size={16} /><h2 className="text-sm font-semibold">Endpoint manifest</h2></div><p className="mt-1 text-xs text-muted-foreground">Exports contain secret references only.</p><textarea className="field mt-4 min-h-[420px] font-mono text-xs" value={content} onChange={(event) => setContent(event.target.value)} />{message && <p className="mt-3 text-xs text-muted-foreground">{message}</p>}<Button className="mt-4" loading={busy} onClick={() => void apply()}>Validate and apply</Button></section>;
}

function Settings({ endpoint, onChanged }: { endpoint: RuntimeEndpointDetail; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(endpoint.name); const [slug, setSlug] = useState(endpoint.slug); const [description, setDescription] = useState(endpoint.description); const [busy, setBusy] = useState(false);
  async function save() { setBusy(true); try { await api(`/api/runtime-endpoints/${endpoint.id}`, { method: "PATCH", body: JSON.stringify({ name, slug, description }) }); await onChanged(); } finally { setBusy(false); } }
  return <section className="panel p-5"><div className="flex items-center gap-2"><Settings2 size={16} /><h2 className="text-sm font-semibold">Endpoint settings</h2></div><div className="mt-5 grid gap-4 md:grid-cols-2"><div><label className="label">Name</label><input className="field" value={name} onChange={(event) => setName(event.target.value)} /></div><div><label className="label">Slug</label><input className="field font-mono" value={slug} onChange={(event) => setSlug(event.target.value)} /></div><div className="md:col-span-2"><label className="label">Description</label><textarea className="field min-h-28" value={description} onChange={(event) => setDescription(event.target.value)} /></div></div><Button className="mt-4" loading={busy} onClick={() => void save()}>Save settings</Button></section>;
}
