"use client";
import { useState } from "react";
import { Link2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { OpsFunction } from "@/lib/types";
import { useToast } from "@/components/providers";
import { Button, Dialog } from "@/components/ui";
import type { MapEndpoint } from "./binding-map-types";

export function ConnectDialog({
  endpoint,
  fn,
  onChanged,
  onClose,
}: {
  endpoint: MapEndpoint;
  fn: OpsFunction;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(
    endpoint.kind === "mcp" ? fn.slug : `/${fn.slug.replaceAll("_", "-")}`,
  );
  const [method, setMethod] = useState("POST");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const toast = useToast();
  async function connect() {
    setBusy(true);
    setError(undefined);
    try {
      await api(
        `/api/runtime-endpoints/${endpoint.id}/${endpoint.kind === "mcp" ? "mcp-bindings" : "http-bindings"}`,
        {
          method: "POST",
          body: JSON.stringify(
            endpoint.kind === "mcp"
              ? {
                  functionId: fn.id,
                  toolName: name,
                  title: fn.name,
                  description: fn.description || `Invoke ${fn.name}`,
                  enabled: true,
                }
              : {
                  functionId: fn.id,
                  method,
                  path: name,
                  inputMapping: null,
                  responseMapping: null,
                  enabled: true,
                },
          ),
        },
      );
      toast({
        title: "Function connected",
        description: "A separate binding node was added to the map.",
        tone: "success",
      });
      onClose();
      onChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      trigger={<span className="hidden" />}
      title={`Connect ${fn.slug}`}
      description={`Create a draft binding on ${endpoint.name}.`}
    >
      <div className="space-y-4">
        {endpoint.kind === "http" && (
          <div>
            <label className="label" htmlFor="binding-map-method">
              Method
            </label>
            <select
              id="binding-map-method"
              className="field"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">
            {endpoint.kind === "mcp" ? "Tool name" : "Route path"}
          </label>
          <input
            className="field font-mono"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <Button loading={busy} disabled={!name} onClick={() => void connect()}>
          <Link2 size={13} /> Connect Function
        </Button>
      </div>
    </Dialog>
  );
}
