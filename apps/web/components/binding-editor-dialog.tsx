"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button, Dialog } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { OpsFunction, RuntimeEndpoint } from "@/lib/types";

export type EditableFunctionBinding =
  | {
      kind: "mcp";
      id: string;
      endpointId: string;
      functionId: string;
      toolName: string;
      title: string;
      description: string;
      enabled: boolean;
    }
  | {
      kind: "http";
      id: string;
      endpointId: string;
      functionId: string;
      method: string;
      path: string;
      inputMapping?: Record<string, unknown> | null;
      responseMapping?: Record<string, unknown> | null;
      enabled: boolean;
    };

type EndpointOption = Pick<RuntimeEndpoint, "id" | "kind" | "name" | "environment">;
type FunctionOption = Pick<OpsFunction, "id" | "name">;

export function BindingEditorDialog({
  endpoints,
  functions,
  fixedFunctionId,
  fixedEndpointId,
  initialKind = "mcp",
  binding,
  onSaved,
  trigger,
}: {
  endpoints: EndpointOption[];
  functions: FunctionOption[];
  fixedFunctionId?: string;
  fixedEndpointId?: string;
  initialKind?: "mcp" | "http";
  binding?: EditableFunctionBinding;
  onSaved: () => Promise<void> | void;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"mcp" | "http">(binding?.kind ?? initialKind);
  const [endpointId, setEndpointId] = useState(
    binding?.endpointId ?? fixedEndpointId ?? "",
  );
  const [functionId, setFunctionId] = useState(
    binding?.functionId ?? fixedFunctionId ?? "",
  );
  const [toolName, setToolName] = useState(
    binding?.kind === "mcp" ? binding.toolName : "",
  );
  const [title, setTitle] = useState(binding?.kind === "mcp" ? binding.title : "");
  const [description, setDescription] = useState(
    binding?.kind === "mcp" ? binding.description : "",
  );
  const [method, setMethod] = useState(
    binding?.kind === "http" ? binding.method : "GET",
  );
  const [path, setPath] = useState(binding?.kind === "http" ? binding.path : "");
  const [inputMapping, setInputMapping] = useState(
    binding?.kind === "http" ? json(binding.inputMapping) : "",
  );
  const [responseMapping, setResponseMapping] = useState(
    binding?.kind === "http" ? json(binding.responseMapping) : "",
  );
  const [enabled, setEnabled] = useState(binding?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const matchingEndpoints = useMemo(
    () => endpoints.filter((endpoint) => endpoint.kind === kind),
    [endpoints, kind],
  );

  useEffect(() => {
    if (!open) return;
    const nextEndpoint = binding?.endpointId ?? fixedEndpointId;
    const nextFunction = binding?.functionId ?? fixedFunctionId;
    if (nextEndpoint) setEndpointId(nextEndpoint);
    else if (!matchingEndpoints.some((endpoint) => endpoint.id === endpointId))
      setEndpointId(matchingEndpoints[0]?.id ?? "");
    if (nextFunction) setFunctionId(nextFunction);
    else if (!functions.some((fn) => fn.id === functionId))
      setFunctionId(functions[0]?.id ?? "");
  }, [
    binding,
    endpointId,
    fixedEndpointId,
    fixedFunctionId,
    functionId,
    functions,
    matchingEndpoints,
    open,
  ]);

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const payload =
        kind === "mcp"
          ? {
              functionId,
              toolName,
              title: title || toolName,
              description,
              enabled,
            }
          : {
              functionId,
              method,
              path,
              inputMapping: parseOptionalObject(inputMapping, "Input mapping"),
              responseMapping: parseOptionalObject(responseMapping, "Response mapping"),
              enabled,
            };
      await api(
        `/api/runtime-endpoints/${endpointId}/${kind === "mcp" ? "mcp-bindings" : "http-bindings"}${binding ? `/${binding.id}` : ""}`,
        {
          method: binding ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      setOpen(false);
      await onSaved();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const defaultTrigger = binding ? (
    <Button variant="ghost" size="icon" aria-label="Edit binding">
      <Pencil size={13} />
    </Button>
  ) : (
    <Button size="sm">
      <Plus size={13} /> Add binding
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(undefined);
      }}
      trigger={trigger ?? defaultTrigger}
      title={binding ? "Edit binding" : "Add Function binding"}
      description="Bindings expose this Function through one existing MCP Endpoint or HTTP API."
    >
      <div className="space-y-4">
        {!binding && !fixedEndpointId && (
          <div>
            <label className="label">Binding type</label>
            <select
              className="field"
              value={kind}
              onChange={(event) => {
                const next = event.target.value as "mcp" | "http";
                setKind(next);
                setEndpointId(
                  endpoints.find((endpoint) => endpoint.kind === next)?.id ?? "",
                );
              }}
            >
              <option value="mcp">MCP tool</option>
              <option value="http">HTTP route</option>
            </select>
          </div>
        )}
        <div>
          <label className="label">Endpoint</label>
          <select
            className="field"
            value={endpointId}
            disabled={Boolean(binding || fixedEndpointId)}
            onChange={(event) => setEndpointId(event.target.value)}
          >
            {!matchingEndpoints.length && (
              <option value="">No matching endpoint</option>
            )}
            {matchingEndpoints.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.name} · {endpoint.environment.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Function</label>
          <select
            className="field"
            value={functionId}
            disabled={Boolean(binding || fixedFunctionId)}
            onChange={(event) => setFunctionId(event.target.value)}
          >
            {functions.map((fn) => (
              <option key={fn.id} value={fn.id}>
                {fn.name}
              </option>
            ))}
          </select>
        </div>
        {kind === "mcp" ? (
          <>
            <div>
              <label className="label">Tool name</label>
              <input
                className="field font-mono"
                value={toolName}
                onChange={(event) => setToolName(event.target.value)}
                placeholder="search_customers"
              />
            </div>
            <div>
              <label className="label">Title</label>
              <input
                className="field"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={toolName || "Search customers"}
              />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea
                className="field min-h-20"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <div>
                <label className="label">Method</label>
                <select
                  className="field"
                  value={method}
                  onChange={(event) => setMethod(event.target.value)}
                >
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Route path</label>
                <input
                  className="field font-mono"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  placeholder="/v1/customers/:customerId"
                />
              </div>
            </div>
            <div>
              <label className="label">Input mapping · JSON object</label>
              <textarea
                className="field min-h-24 font-mono text-[11px]"
                value={inputMapping}
                onChange={(event) => setInputMapping(event.target.value)}
                placeholder={'{"customerId":"path.customerId"}'}
              />
            </div>
            <div>
              <label className="label">Response mapping · JSON object</label>
              <textarea
                className="field min-h-24 font-mono text-[11px]"
                value={responseMapping}
                onChange={(event) => setResponseMapping(event.target.value)}
                placeholder={'{"statusCode":200,"body":"$"}'}
              />
            </div>
          </>
        )}
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />{" "}
          Enabled
        </label>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <Button
          loading={busy}
          disabled={!endpointId || !functionId || (kind === "mcp" ? !toolName : !path)}
          onClick={() => void save()}
        >
          {binding ? "Save binding" : "Create binding"}
        </Button>
      </div>
    </Dialog>
  );
}

function parseOptionalObject(
  value: string,
  label: string,
): Record<string, unknown> | null {
  if (!value.trim()) return null;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object.`);
  return parsed as Record<string, unknown>;
}

function json(value: unknown): string {
  return value == null ? "" : JSON.stringify(value, null, 2);
}
