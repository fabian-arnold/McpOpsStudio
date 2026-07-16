"use client";
import { type FormEvent, useState } from "react";
import { Ban, KeyRound, Plus, ShieldAlert } from "lucide-react";
import { useToast } from "@/components/providers";
import { Badge, Button, Dialog } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { RuntimeEndpointDetail } from "@/lib/types";
import type { Connection } from "./reviewed-database-types";
import { FormError } from "./reviewed-database-fields";

export function FeatureState({
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

export function ConnectionRow({
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

export function ConnectionDialog({
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
          <label className="label" htmlFor="reviewed-connection-name">
            Name
          </label>
          <input
            id="reviewed-connection-name"
            className="field font-mono"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="analytics_readonly"
          />
        </div>
        <div>
          <label className="label" htmlFor="reviewed-connection-secret">
            Environment secret
          </label>
          <select
            id="reviewed-connection-secret"
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
          <label className="label" htmlFor="reviewed-connection-description">
            Description
          </label>
          <textarea
            id="reviewed-connection-description"
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
