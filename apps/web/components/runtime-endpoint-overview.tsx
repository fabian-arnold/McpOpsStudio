"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Activity,
  Boxes,
  Code2,
  Plus,
  Route,
  ShieldCheck,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { api } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type { HttpBinding, McpBinding, RuntimeEndpointDetail } from "@/lib/types";
import { EnvironmentEndpointUrls } from "@/components/environment-endpoint-urls";
import {
  BindingEditorDialog,
  type EditableFunctionBinding,
} from "@/components/binding-editor-dialog";

import type { EndpointKind } from "./runtime-endpoint-types";

export function Overview({
  endpoint,
  kind,
}: {
  endpoint: RuntimeEndpointDetail;
  kind: EndpointKind;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<Boxes size={15} />}
          label="Active deployment"
          value={
            endpoint.activeDeployment ? `v${endpoint.activeDeployment.version}` : "None"
          }
        />
        <Stat
          icon={<Code2 size={15} />}
          label="Bound Functions"
          value={endpoint.functionCount}
        />
        <Stat
          icon={<Activity size={15} />}
          label="Calls · 24h"
          value={endpoint.telemetry?.calls ?? 0}
        />
        <Stat
          icon={<ShieldCheck size={15} />}
          label="Authentication"
          value={endpoint.authMode}
        />
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

export function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <p className="mt-3 text-xl font-semibold">{value}</p>
    </div>
  );
}

export function Bindings({
  endpoint,
  kind,
  onChanged,
}: {
  endpoint: RuntimeEndpointDetail;
  kind: EndpointKind;
  onChanged: () => Promise<void>;
}) {
  const user = useCurrentUser();
  const canManage = roleAllows(user?.role, ["owner", "admin", "developer"]);
  const bindings = kind === "mcp" ? endpoint.mcpBindings : endpoint.httpBindings;
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b p-4">
        <div>
          <h2 className="text-sm font-semibold">
            {kind === "mcp" ? "MCP tools" : "HTTP routes"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Every binding selects a reusable project Function.
          </p>
        </div>
        {canManage && (
          <BindingEditorDialog
            endpoints={[endpoint]}
            functions={endpoint.functions}
            fixedEndpointId={endpoint.id}
            initialKind={kind}
            onSaved={onChanged}
            trigger={
              <Button size="sm">
                <Plus size={14} /> Add {kind === "mcp" ? "tool" : "route"}
              </Button>
            }
          />
        )}
      </div>
      {!bindings.length ? (
        <EmptyState
          icon={kind === "mcp" ? <TerminalSquare /> : <Route />}
          title="No bindings"
          description="Assign a project Function to expose it from this endpoint."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-muted/30 text-muted-foreground">
              <tr>
                <th className="p-3">Exposure</th>
                <th className="p-3">Function</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {bindings.map((binding) => {
                const fn = endpoint.functions.find(
                  (item) => item.id === binding.functionId,
                );
                const exposure =
                  kind === "mcp"
                    ? (binding as McpBinding).toolName
                    : `${(binding as HttpBinding).method} ${(binding as HttpBinding).path}`;
                const editable: EditableFunctionBinding =
                  kind === "mcp"
                    ? {
                        kind: "mcp",
                        id: binding.id,
                        endpointId: endpoint.id,
                        functionId: binding.functionId,
                        toolName: (binding as McpBinding).toolName,
                        title: (binding as McpBinding).title,
                        description: (binding as McpBinding).description,
                        enabled: binding.enabled,
                      }
                    : {
                        kind: "http",
                        id: binding.id,
                        endpointId: endpoint.id,
                        functionId: binding.functionId,
                        method: (binding as HttpBinding).method,
                        path: (binding as HttpBinding).path,
                        inputMapping: (binding as HttpBinding).inputMapping ?? null,
                        responseMapping:
                          (binding as HttpBinding).responseMapping ?? null,
                        enabled: binding.enabled,
                      };
                return (
                  <tr key={binding.id} className="border-b last:border-0">
                    <td className="p-3 font-mono">{exposure}</td>
                    <td className="p-3">
                      <Link
                        className="hover:text-primary"
                        href={`/functions/${binding.functionId}`}
                      >
                        {fn?.name ?? "Unknown"}
                      </Link>
                    </td>
                    <td className="p-3">
                      <Badge tone={binding.enabled ? "success" : "neutral"}>
                        {binding.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      {canManage && (
                        <div className="inline-flex items-center gap-1">
                          <BindingEditorDialog
                            endpoints={[endpoint]}
                            functions={endpoint.functions}
                            fixedEndpointId={endpoint.id}
                            binding={editable}
                            onSaved={onChanged}
                          />
                          <DeleteBinding
                            endpointId={endpoint.id}
                            kind={kind}
                            bindingId={binding.id}
                            onDeleted={onChanged}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function DeleteBinding({
  endpointId,
  kind,
  bindingId,
  onDeleted,
}: {
  endpointId: string;
  kind: EndpointKind;
  bindingId: string;
  onDeleted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (
      !window.confirm(
        "Remove this binding? Runtime traffic remains unchanged until the Project is deployed.",
      )
    )
      return;
    setBusy(true);
    try {
      await api(
        `/api/runtime-endpoints/${endpointId}/${kind === "mcp" ? "mcp-bindings" : "http-bindings"}/${bindingId}`,
        { method: "DELETE" },
      );
      await onDeleted();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      loading={busy}
      onClick={() => void remove()}
      aria-label="Delete binding"
    >
      <Trash2 size={14} />
    </Button>
  );
}
