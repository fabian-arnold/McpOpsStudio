"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, KeyRound, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Dialog, EmptyState } from "@/components/ui";
import { useToast } from "@/components/providers";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type { RuntimeEndpointDetail } from "@/lib/types";

export function Authentication({
  endpoint,
  onChanged,
}: {
  endpoint: RuntimeEndpointDetail;
  onChanged: () => Promise<void>;
}) {
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
      await api(`/api/runtime-endpoints/${endpoint.id}/auth-policies/${policyId}`, {
        method: "DELETE",
      });
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
            Policies are checked from top to bottom until one authenticates the request.
          </p>
        </div>
        {canManage && <CreateAuthPolicy endpoint={endpoint} onSaved={onChanged} />}
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

export function CreateAuthPolicy({
  endpoint,
  onSaved,
}: {
  endpoint: RuntimeEndpointDetail;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<
    "public" | "api_key" | "bearer_token" | "basic_auth"
  >("api_key");
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
    setBusy(true);
    setError(undefined);
    try {
      if (type !== "public" && !existingSecret && !secretValue)
        throw new Error("Enter a credential value for the new Secret.");
      if (type !== "public" && !existingSecret)
        await api("/api/secrets", {
          method: "POST",
          body: JSON.stringify({
            environmentId: endpoint.environment.id,
            name: secretName,
            value: secretValue,
          }),
        });
      const permissionList = permissions
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const config =
        type === "public"
          ? { permissions: permissionList }
          : type === "api_key"
            ? {
                header: "x-api-key",
                secretRef: secretName,
                permissions: permissionList,
              }
            : type === "bearer_token"
              ? {
                  header: "authorization",
                  scheme: "Bearer",
                  secretRef: secretName,
                  permissions: permissionList,
                }
              : {
                  header: "authorization",
                  scheme: "Basic",
                  username,
                  secretRef: secretName,
                  permissions: permissionList,
                };
      await api(`/api/runtime-endpoints/${endpoint.id}/auth-policies`, {
        method: "POST",
        body: JSON.stringify({ name, type, config }),
      });
      setOpen(false);
      setSecretValue("");
      toast({
        title: "Authentication policy created",
        description:
          "The policy was added last in the authentication order. Deploy the Project to publish it.",
        tone: "success",
      });
      await onSaved();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm">
          <Plus size={14} /> Add authentication
        </Button>
      }
      title="Add endpoint authentication"
      description="Create and append an authentication policy to this endpoint."
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="endpoint-auth-type">
            Authentication type
          </label>
          <select
            id="endpoint-auth-type"
            className="field"
            value={type}
            onChange={(event) => setType(event.target.value as typeof type)}
          >
            <option value="public">Public (no authentication)</option>
            <option value="api_key">API key</option>
            <option value="bearer_token">Bearer token</option>
            <option value="basic_auth">HTTP Basic</option>
          </select>
        </div>
        {type === "public" && (
          <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            Anyone who can reach this endpoint can list or invoke bindings allowed by
            the permissions below. A public policy makes every policy below it
            unreachable.
          </p>
        )}
        <div>
          <label className="label" htmlFor="endpoint-auth-name">
            Policy name
          </label>
          <input
            id="endpoint-auth-name"
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={type === "public" ? "Public access" : "Agent access"}
          />
        </div>
        {type === "basic_auth" && (
          <div>
            <label className="label" htmlFor="endpoint-auth-username">
              Username
            </label>
            <input
              id="endpoint-auth-username"
              className="field"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
        )}
        {type !== "public" && (
          <>
            <div>
              <label className="label" htmlFor="endpoint-auth-secret-name">
                Credential Secret name
              </label>
              <input
                id="endpoint-auth-secret-name"
                className="field font-mono"
                list={`auth-secrets-${endpoint.id}`}
                value={secretName}
                onChange={(event) => setSecretName(event.target.value.toUpperCase())}
                placeholder="MCP_CLIENT_API_KEY"
              />
              <datalist id={`auth-secrets-${endpoint.id}`}>
                {endpoint.secrets.map((secret) => (
                  <option key={secret.id} value={secret.name} />
                ))}
              </datalist>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Select an existing environment Secret or enter a new uppercase name.
              </p>
            </div>
            <div>
              <label className="label">
                {existingSecret
                  ? "Credential value (already stored)"
                  : "Credential value"}
              </label>
              <input
                className="field"
                type="password"
                value={secretValue}
                disabled={existingSecret}
                onChange={(event) => setSecretValue(event.target.value)}
                placeholder={
                  existingSecret
                    ? "Existing Secret will be used"
                    : "Stored encrypted and never shown again"
                }
              />
            </div>
          </>
        )}
        <div>
          <label className="label" htmlFor="endpoint-auth-permissions">
            Granted Function permissions
          </label>
          <input
            id="endpoint-auth-permissions"
            className="field font-mono"
            value={permissions}
            onChange={(event) => setPermissions(event.target.value)}
            placeholder="customers.read, customers.write"
          />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <Button
          loading={busy}
          disabled={
            !name ||
            (type !== "public" && !secretName) ||
            (type === "basic_auth" && !username)
          }
          onClick={() => void save()}
        >
          Create and add policy
        </Button>
      </div>
    </Dialog>
  );
}
