"use client";
import { useEffect, useState } from "react";
import { Activity, FileJson, Settings2 } from "lucide-react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { RuntimeEndpointDetail } from "@/lib/types";

export function NetworkPolicy({
  endpoint,
  onChanged,
}: {
  endpoint: RuntimeEndpointDetail;
  onChanged: () => Promise<void>;
}) {
  const policy = endpoint.networkPolicy as RuntimeEndpointDetail["networkPolicy"] & {
    allowedPorts?: number[];
    allowPrivateHosts?: string[];
    maxResponseBytes?: number;
  };
  const [hosts, setHosts] = useState((policy.allowedHosts ?? []).join("\n"));
  const [methods, setMethods] = useState((policy.allowedMethods ?? ["GET"]).join(", "));
  const [ports, setPorts] = useState((policy.allowedPorts ?? [443]).join(", "));
  const [privateHosts, setPrivateHosts] = useState(
    (policy.allowPrivateHosts ?? []).join("\n"),
  );
  const [maxResponseBytes, setMaxResponseBytes] = useState(
    policy.maxResponseBytes ?? 1048576,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  async function save() {
    setBusy(true);
    setMessage(undefined);
    try {
      await api(`/api/runtime-endpoints/${endpoint.id}/network-policy`, {
        method: "PUT",
        body: JSON.stringify({
          allowedHosts: hosts.split(/\s+/).filter(Boolean),
          allowedMethods: methods
            .split(",")
            .map((value) => value.trim().toUpperCase())
            .filter(Boolean),
          allowedPorts: ports
            .split(",")
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isInteger(value)),
          allowPrivateHosts: privateHosts.split(/\s+/).filter(Boolean),
          maxResponseBytes,
        }),
      });
      await onChanged();
      setMessage("Network policy saved.");
    } catch (reason) {
      setMessage(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel p-5">
      <h2 className="text-sm font-semibold">Outbound network policy</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        The policy is endpoint-specific even when Functions are reused elsewhere.
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="network-allowed-hosts">
            Allowed hosts · one per line
          </label>
          <textarea
            className="field min-h-36 font-mono"
            id="network-allowed-hosts"
            value={hosts}
            onChange={(event) => setHosts(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="network-allowed-methods">
            Allowed methods · comma separated
          </label>
          <input
            className="field font-mono"
            id="network-allowed-methods"
            value={methods}
            onChange={(event) => setMethods(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="network-allowed-ports">
            Allowed ports · comma separated
          </label>
          <input
            className="field font-mono"
            id="network-allowed-ports"
            inputMode="numeric"
            value={ports}
            onChange={(event) => setPorts(event.target.value)}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Use only the destination ports required by these Functions.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="network-max-response-bytes">
            Maximum response size · bytes
          </label>
          <input
            className="field font-mono"
            id="network-max-response-bytes"
            max={10485760}
            min={1024}
            type="number"
            value={maxResponseBytes}
            onChange={(event) => setMaxResponseBytes(Number(event.target.value))}
          />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="network-private-hosts">
            Approved private hosts · one per line
          </label>
          <textarea
            className="field min-h-28 font-mono"
            id="network-private-hosts"
            placeholder="Internal hosts remain blocked unless explicitly listed here"
            value={privateHosts}
            onChange={(event) => setPrivateHosts(event.target.value)}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Each host must also appear in Allowed hosts. Metadata addresses remain
            blocked even when listed.
          </p>
        </div>
      </div>
      {message && <p className="mt-3 text-xs text-muted-foreground">{message}</p>}
      <Button className="mt-4" loading={busy} onClick={() => void save()}>
        Save network policy
      </Button>
    </section>
  );
}

export function Executions({ endpoint }: { endpoint: RuntimeEndpointDetail }) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">Recent executions</h2>
      </div>
      {!endpoint.executions.length ? (
        <EmptyState
          icon={<Activity />}
          title="No executions"
          description="Calls through this endpoint will appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="p-3">Time</th>
                <th className="p-3">Function</th>
                <th className="p-3">Version</th>
                <th className="p-3">Source</th>
                <th className="p-3">Status</th>
                <th className="p-3">Latency</th>
              </tr>
            </thead>
            <tbody>
              {endpoint.executions.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="p-3">{new Date(item.createdAt).toLocaleString()}</td>
                  <td className="p-3 font-mono">{item.functionName}</td>
                  <td className="p-3">v{item.functionVersion}</td>
                  <td className="p-3">{item.invocationSource}</td>
                  <td className="p-3">
                    <Badge tone={item.status === "success" ? "success" : "danger"}>
                      {item.status}
                    </Badge>
                  </td>
                  <td className="p-3">{item.durationMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function Manifest({ endpoint }: { endpoint: RuntimeEndpointDetail }) {
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    api<{ content: string }>(
      `/api/runtime-endpoints/${endpoint.id}/manifest?format=yaml`,
    )
      .then((value) => setContent(value.content))
      .catch((reason) => setMessage(errorMessage(reason)));
  }, [endpoint.id]);
  async function apply() {
    setBusy(true);
    setMessage(undefined);
    try {
      await api(`/api/runtime-endpoints/${endpoint.id}/manifest`, {
        method: "POST",
        body: JSON.stringify({ format: "yaml", content, apply: true }),
      });
      setMessage("Manifest applied.");
    } catch (reason) {
      setMessage(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel p-5">
      <div className="flex items-center gap-2">
        <FileJson size={16} />
        <h2 className="text-sm font-semibold">Endpoint manifest</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Exports contain secret references only.
      </p>
      <textarea
        className="field mt-4 min-h-[420px] font-mono text-xs"
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
      {message && <p className="mt-3 text-xs text-muted-foreground">{message}</p>}
      <Button className="mt-4" loading={busy} onClick={() => void apply()}>
        Validate and apply
      </Button>
    </section>
  );
}

export function Settings({
  endpoint,
  onChanged,
}: {
  endpoint: RuntimeEndpointDetail;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(endpoint.name);
  const [slug, setSlug] = useState(endpoint.slug);
  const [description, setDescription] = useState(endpoint.description);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api(`/api/runtime-endpoints/${endpoint.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, slug, description }),
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel p-5">
      <div className="flex items-center gap-2">
        <Settings2 size={16} />
        <h2 className="text-sm font-semibold">Endpoint settings</h2>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label className="label">Slug</label>
          <input
            className="field font-mono"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">Description</label>
          <textarea
            className="field min-h-28"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
      </div>
      <Button className="mt-4" loading={busy} onClick={() => void save()}>
        Save settings
      </Button>
    </section>
  );
}
