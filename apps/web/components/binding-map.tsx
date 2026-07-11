"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Globe2,
  GripVertical,
  Link2,
  Plus,
  RefreshCw,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type { OpsFunction } from "@/lib/types";
import { useToast } from "@/components/providers";
import { Badge, Button, Dialog, EmptyState, LoadError, Skeleton } from "@/components/ui";

type McpBinding = {
  id: string;
  functionId: string;
  toolName: string;
  title: string;
  enabled: boolean;
};
type HttpBinding = {
  id: string;
  functionId: string;
  method: string;
  path: string;
  enabled: boolean;
};
type MapEndpoint = {
  id: string;
  name: string;
  slug: string;
  kind: "mcp" | "http";
  status: string;
  mcpToolBindings: McpBinding[];
  httpRouteBindings: HttpBinding[];
};

export function BindingMap({ functions }: { functions: OpsFunction[] }) {
  const [endpoints, setEndpoints] = useState<MapEndpoint[]>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const user = useCurrentUser();
  const canManage = roleAllows(user?.role, ["owner", "admin", "developer"]);
  const load = useCallback(() => {
    setError(undefined);
    api<MapEndpoint[]>("/api/binding-map")
      .then(setEndpoints)
      .catch((reason) => setError(errorMessage(reason)));
  }, []);
  useEffect(load, [load, revision]);

  if (error)
    return (
      <LoadError
        title="Unable to load the binding map"
        message={error}
        onRetry={() => setRevision((value) => value + 1)}
      />
    );
  if (!endpoints) return <Skeleton className="h-80 w-full" />;
  if (!endpoints.length)
    return (
      <EmptyState
        icon={<Link2 />}
        title="No endpoints to map"
        description="Create an MCP Endpoint or HTTP API before assigning Functions."
      />
    );

  const mcpEndpoints = endpoints.filter((endpoint) => endpoint.kind === "mcp");
  const httpEndpoints = endpoints.filter((endpoint) => endpoint.kind === "http");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Function binding map</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Drag a Function node onto an MCP Endpoint or HTTP API node to create
            a tool or route binding. Existing connections are shown on each node.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setRevision((value) => value + 1)}>
          <RefreshCw size={13} /> Refresh
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] bg-[length:22px_22px] p-6">
        <div className="grid min-w-[980px] grid-cols-[minmax(280px,1fr)_260px_minmax(280px,1fr)] items-start gap-12">
          <section className="space-y-3">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">MCP Endpoints</p>
            {mcpEndpoints.map((endpoint) => <EndpointNode key={endpoint.id} endpoint={endpoint} functions={functions} canManage={canManage} onChanged={() => setRevision((value) => value + 1)} />)}
          </section>
          <section className="space-y-3">
            <p className="mb-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reusable Functions</p>
            {functions.map((fn) => (
              <article
                key={fn.id}
                draggable={canManage && fn.enabled}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData("application/x-mcpops-function", fn.id);
                }}
                className={`rounded-xl border bg-card p-3 shadow-sm ${canManage && fn.enabled ? "cursor-grab hover:border-primary/40 hover:shadow-md active:cursor-grabbing" : "opacity-70"}`}
              >
                <div className="flex items-start gap-2">
                  <GripVertical className="mt-0.5 shrink-0 text-muted-foreground" size={14} />
                  <div className="min-w-0 flex-1"><Link href={`/functions/${fn.id}`} className="block truncate font-mono text-xs font-semibold hover:text-primary">{fn.slug}</Link><div className="mt-2 flex items-center gap-2"><Badge tone={fn.enabled ? "success" : "neutral"}>{fn.enabled ? `v${fn.version}` : "disabled"}</Badge><span className="text-[10px] text-muted-foreground">{fn.riskLevel}</span></div></div>
                </div>
              </article>
            ))}
          </section>
          <section className="space-y-3">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">HTTP APIs</p>
            {httpEndpoints.map((endpoint) => <EndpointNode key={endpoint.id} endpoint={endpoint} functions={functions} canManage={canManage} onChanged={() => setRevision((value) => value + 1)} />)}
          </section>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Binding changes are drafts. Deploy the Project to update development;
        release that immutable Project version separately to production.
      </p>
    </div>
  );
}

function EndpointNode({ endpoint, functions, canManage, onChanged }: { endpoint: MapEndpoint; functions: OpsFunction[]; canManage: boolean; onChanged: () => void }) {
  const [draggingOver, setDraggingOver] = useState(false);
  const [pending, setPending] = useState<OpsFunction>();
  const [removingId, setRemovingId] = useState<string>();
  const toast = useToast();
  const bindings: Array<McpBinding | HttpBinding> = endpoint.kind === "mcp" ? endpoint.mcpToolBindings : endpoint.httpRouteBindings;
  async function remove(binding: McpBinding | HttpBinding) {
    if (!window.confirm("Remove this binding from the development configuration?")) return;
    setRemovingId(binding.id);
    try {
      await api(`/api/runtime-endpoints/${endpoint.id}/${endpoint.kind === "mcp" ? "mcp-bindings" : "http-bindings"}/${binding.id}`, { method: "DELETE" });
      toast({ title: "Binding removed", description: "Deploy the Project to publish this change.", tone: "success" });
      onChanged();
    } catch (reason) {
      toast({ title: "Binding was not removed", description: errorMessage(reason), tone: "error" });
    } finally { setRemovingId(undefined); }
  }
  return (
    <article
      onDragEnter={(event) => { if (canManage) { event.preventDefault(); setDraggingOver(true); } }}
      onDragOver={(event) => { if (canManage) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
      onDragLeave={() => setDraggingOver(false)}
      onDrop={(event) => {
        event.preventDefault(); setDraggingOver(false);
        const functionId = event.dataTransfer.getData("application/x-mcpops-function");
        const fn = functions.find((item) => item.id === functionId && item.enabled);
        if (canManage && fn) setPending(fn);
      }}
      className={`rounded-xl border-2 bg-card p-4 shadow-sm transition ${draggingOver ? "border-primary bg-primary/[.06] shadow-lg" : "border-border"}`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{endpoint.kind === "mcp" ? <TerminalSquare size={15} /> : <Globe2 size={15} />}</span>
        <div className="min-w-0 flex-1"><Link href={`${endpoint.kind === "mcp" ? "/mcp-endpoints" : "/http-apis"}/${endpoint.id}?tab=bindings`} className="block truncate text-sm font-semibold hover:text-primary">{endpoint.name}</Link><p className="mt-1 font-mono text-[10px] text-muted-foreground">{endpoint.kind === "mcp" ? "MCP Endpoint" : "HTTP API"} · {bindings.length} bindings</p></div>
      </div>
      <div className="mt-3 space-y-1.5">
        {bindings.map((binding) => {
          const fn = functions.find((item) => item.id === binding.functionId);
          return <div key={binding.id} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-2"><Link2 size={11} className="shrink-0 text-primary" /><span className="min-w-0 flex-1"><code className="block truncate text-[10px] font-semibold">{endpoint.kind === "mcp" ? (binding as McpBinding).toolName : `${(binding as HttpBinding).method} ${(binding as HttpBinding).path}`}</code><span className="block truncate text-[9px] text-muted-foreground">{fn?.slug ?? "Unknown Function"}</span></span>{canManage && <Button variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-red-500" loading={removingId === binding.id} onClick={() => void remove(binding)}><Trash2 size={11} /></Button>}</div>;
        })}
        {!bindings.length && <div className="grid min-h-14 place-items-center rounded-lg border border-dashed text-[10px] text-muted-foreground">Drop a Function here</div>}
      </div>
      {pending && <ConnectDialog endpoint={endpoint} fn={pending} onChanged={onChanged} forceOpen hideTrigger onForceClose={() => setPending(undefined)} />}
    </article>
  );
}

function BindingCell({
  endpoint,
  fn,
  canManage,
  onChanged,
}: {
  endpoint: MapEndpoint;
  fn: OpsFunction;
  canManage: boolean;
  onChanged: () => void;
}) {
  const bindings = (
    endpoint.kind === "mcp"
      ? endpoint.mcpToolBindings
      : endpoint.httpRouteBindings
  ).filter((item) => item.functionId === fn.id);
  const toast = useToast();
  const [removing, setRemoving] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  async function remove(binding: McpBinding | HttpBinding) {
    if (!window.confirm("Remove this Function binding from the development configuration?")) return;
    setRemoving(true);
    try {
      await api(
        `/api/runtime-endpoints/${endpoint.id}/${endpoint.kind === "mcp" ? "mcp-bindings" : "http-bindings"}/${binding.id}`,
        { method: "DELETE" },
      );
      toast({ title: "Binding removed", description: "Deploy the Project to publish this change.", tone: "success" });
      onChanged();
    } catch (reason) {
      toast({ title: "Binding was not removed", description: errorMessage(reason), tone: "error" });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <td
      className="border-r p-3 align-top last:border-r-0"
      onDragOver={(event) => {
        if (!canManage || !fn.enabled) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (
          canManage &&
          fn.enabled &&
          event.dataTransfer.getData("application/x-mcpops-function") === fn.id
        )
          setDropOpen(true);
      }}
    >
      <div className="space-y-2">
        {bindings.map((binding) => (
          <div key={binding.id} className="flex min-h-16 items-start gap-2 rounded-lg border border-primary/20 bg-primary/[.04] p-3">
            <Link2 className="mt-0.5 shrink-0 text-primary" size={13} />
            <div className="min-w-0 flex-1">
              <code className="block truncate text-[11px] font-semibold">
                {endpoint.kind === "mcp"
                  ? (binding as McpBinding).toolName
                  : `${(binding as HttpBinding).method} ${(binding as HttpBinding).path}`}
              </code>
              <span className="mt-1 block text-[10px] text-muted-foreground">
                {binding.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            {canManage && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-red-500"
                loading={removing}
                onClick={() => void remove(binding)}
                aria-label="Remove binding"
              >
                <Trash2 size={12} />
              </Button>
            )}
          </div>
        ))}
        {canManage && fn.enabled ? (
          <ConnectDialog
            endpoint={endpoint}
            fn={fn}
            onChanged={onChanged}
            compact={bindings.length > 0}
            forceOpen={dropOpen}
            onForceClose={() => setDropOpen(false)}
          />
        ) : bindings.length === 0 ? (
        <div className="grid min-h-16 place-items-center rounded-lg border border-dashed text-[10px] text-muted-foreground">
          Not connected
        </div>
        ) : null}
      </div>
    </td>
  );
}

function ConnectDialog({ endpoint, fn, onChanged, compact = false, forceOpen = false, hideTrigger = false, onForceClose }: { endpoint: MapEndpoint; fn: OpsFunction; onChanged: () => void; compact?: boolean; forceOpen?: boolean; hideTrigger?: boolean; onForceClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(endpoint.kind === "mcp" ? fn.slug : `/${fn.slug.replaceAll("_", "-")}`);
  const [method, setMethod] = useState("POST");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const toast = useToast();
  async function connect() {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/api/runtime-endpoints/${endpoint.id}/${endpoint.kind === "mcp" ? "mcp-bindings" : "http-bindings"}`, {
        method: "POST",
        body: JSON.stringify(
          endpoint.kind === "mcp"
            ? { functionId: fn.id, toolName: name, title: fn.title, description: fn.description || `Invoke ${fn.title}`, enabled: true }
            : { functionId: fn.id, method, path: name, inputMapping: null, responseMapping: null, enabled: true },
        ),
      });
      setOpen(false);
      toast({ title: "Function connected", description: "Deploy the Project to publish this binding.", tone: "success" });
      onChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open || forceOpen}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onForceClose?.();
      }}
      trigger={
        <button className={`${hideTrigger ? "hidden" : "flex"} w-full items-center justify-center gap-1.5 rounded-lg border border-dashed text-[10px] text-muted-foreground transition hover:border-primary/40 hover:bg-primary/[.03] hover:text-primary ${compact ? "h-8" : "min-h-16"}`}>
          <Plus size={12} /> {compact ? "Add binding" : "Connect"}
        </button>
      }
      title={`Connect ${fn.slug}`}
      description={`Create a draft binding on ${endpoint.name}.`}
    >
      <div className="space-y-4">
        {endpoint.kind === "http" && (
          <div>
            <label className="label">Method</label>
            <select className="field" value={method} onChange={(event) => setMethod(event.target.value)}>
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => <option key={value}>{value}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label">{endpoint.kind === "mcp" ? "Tool name" : "Route path"}</label>
          <input className="field font-mono" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <Button loading={busy} disabled={!name} onClick={() => void connect()}>
          Connect Function
        </Button>
      </div>
    </Dialog>
  );
}
