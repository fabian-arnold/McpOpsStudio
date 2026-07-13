"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  LoadError,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/providers";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";

type PolicyType =
  | "public"
  | "api_key"
  | "bearer_token"
  | "basic_auth"
  | "jwt"
  | "entra_id"
  | "webhook_signature";

type AuthPolicy = {
  id: string;
  name: string;
  type: PolicyType;
  config: Record<string, unknown>;
  providerStatus: string;
  assignments: Array<{
    endpointId: string;
    endpointName: string;
    endpointKind: "mcp" | "http";
    position: number;
  }>;
};

const policyTypes: Array<{ value: PolicyType; label: string }> = [
  { value: "public", label: "Public" },
  { value: "api_key", label: "API key" },
  { value: "bearer_token", label: "Bearer token" },
  { value: "basic_auth", label: "HTTP Basic" },
  { value: "jwt", label: "JWT / JWKS" },
  { value: "entra_id", label: "Microsoft Entra ID" },
  { value: "webhook_signature", label: "Webhook signature" },
];

const defaultConfigs: Record<PolicyType, Record<string, unknown>> = {
  public: { permissions: [] },
  api_key: {
    header: "x-api-key",
    secretRef: "PROJECT_API_KEY",
    permissions: [],
  },
  bearer_token: {
    header: "authorization",
    scheme: "Bearer",
    secretRef: "PROJECT_BEARER_TOKEN",
    permissions: [],
  },
  basic_auth: {
    header: "authorization",
    scheme: "Basic",
    username: "service-user",
    secretRef: "PROJECT_BASIC_PASSWORD",
    permissions: [],
  },
  jwt: {
    header: "authorization",
    scheme: "Bearer",
    issuer: "https://issuer.example.com/",
    audience: "mcp-ops",
    jwksUrl: "https://issuer.example.com/.well-known/jwks.json",
    requiredClaims: {},
    clockSkewSeconds: 30,
  },
  entra_id: {
    header: "authorization",
    scheme: "Bearer",
    tenantMode: "single_tenant",
    tenantId: "00000000-0000-4000-8000-000000000000",
    audience: "api://mcp-ops",
    requiredClaims: {},
    allowedTenantIds: [],
    clockSkewSeconds: 60,
  },
  webhook_signature: {
    algorithm: "hmac-sha256",
    header: "x-mcpops-signature",
    timestampHeader: "x-mcpops-timestamp",
    signaturePrefix: "sha256=",
    secretRef: "WEBHOOK_SIGNING_SECRET",
    toleranceSeconds: 300,
    replayProtection: true,
    permissions: [],
  },
};

export default function AuthenticationPoliciesPage() {
  const user = useCurrentUser();
  const canManage = roleAllows(user?.role, ["owner", "admin"]);
  const [policies, setPolicies] = useState<AuthPolicy[]>();
  const [loadError, setLoadError] = useState<string>();
  const [revision, setRevision] = useState(0);

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      setPolicies(await api<AuthPolicy[]>("/api/auth-policies"));
    } catch (reason) {
      setLoadError(errorMessage(reason));
    }
  }, []);
  useEffect(() => void load(), [load, revision]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Project"
        title="Authentication policies"
        description={`Reusable endpoint authentication policies for ${user?.project.name ?? "the selected project"}. Assign and order them from each MCP Endpoint or HTTP API.`}
        actions={
          canManage ? (
            <PolicyDialog
              onSaved={() => setRevision((value) => value + 1)}
            />
          ) : undefined
        }
      />
      {loadError ? (
        <LoadError
          title="Unable to load authentication policies"
          message={loadError}
          onRetry={() => setRevision((value) => value + 1)}
        />
      ) : !policies ? (
        <Skeleton className="h-72" />
      ) : policies.length ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="hidden grid-cols-[minmax(220px,1fr)_150px_minmax(220px,1fr)_150px] gap-4 border-b bg-muted/30 px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
            <span>Policy</span>
            <span>Provider</span>
            <span>Endpoint assignments</span>
            <span />
          </div>
          {policies.map((policy) => (
            <PolicyRow
              key={policy.id}
              policy={policy}
              canManage={canManage}
              onChanged={() => setRevision((value) => value + 1)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<ShieldCheck />}
          title="No authentication policies"
          description="Create a reusable policy, then assign it to one or more endpoints."
          action={
            canManage ? (
              <PolicyDialog
                onSaved={() => setRevision((value) => value + 1)}
              />
            ) : undefined
          }
        />
      )}
      <div className="mt-5 rounded-xl border p-4 text-xs text-muted-foreground">
        <strong className="text-foreground">Draft configuration.</strong>{" "}
        Policy changes reach development only after a Project deployment and
        production only after releasing that immutable snapshot. Secret values
        are never shown here; configurations contain Secret names only.
      </div>
    </AppShell>
  );
}

function PolicyRow({
  policy,
  canManage,
  onChanged,
}: {
  policy: AuthPolicy;
  canManage: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (
      !window.confirm(
        `Delete “${policy.name}”? This cannot be undone.`,
      )
    )
      return;
    setDeleting(true);
    try {
      await api(`/api/auth-policies/${policy.id}`, { method: "DELETE" });
      toast({
        title: "Authentication policy deleted",
        description: policy.name,
        tone: "success",
      });
      onChanged();
    } catch (reason) {
      toast({
        title: "Policy was not deleted",
        description: errorMessage(reason),
        tone: "error",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="grid gap-4 border-b px-5 py-4 last:border-b-0 md:grid-cols-[minmax(220px,1fr)_150px_minmax(220px,1fr)_150px] md:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <KeyRound size={16} />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{policy.name}</h2>
          <code className="text-[10px] text-muted-foreground">{policy.id}</code>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge>{policy.type.replaceAll("_", " ")}</Badge>
        {policy.providerStatus !== "enabled" && (
          <Badge tone="warning">{policy.providerStatus}</Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {policy.assignments.length ? (
          policy.assignments.map((assignment) => (
            <Badge key={assignment.endpointId} tone="neutral">
              {assignment.endpointName} · {assignment.position + 1}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">Not assigned</span>
        )}
      </div>
      <div className="flex items-center justify-end gap-1">
        <PolicyDialog policy={policy} readOnly={!canManage} onSaved={onChanged} />
        {canManage && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-red-500"
            loading={deleting}
            disabled={policy.assignments.length > 0}
            title={
              policy.assignments.length
                ? "Remove this policy from all endpoints before deleting it"
                : "Delete policy"
            }
            onClick={() => void remove()}
            aria-label={`Delete ${policy.name}`}
          >
            <Trash2 size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}

function PolicyDialog({
  policy,
  readOnly = false,
  onSaved,
}: {
  policy?: AuthPolicy;
  readOnly?: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(policy?.name ?? "");
  const [type, setType] = useState<PolicyType>(policy?.type ?? "api_key");
  const [config, setConfig] = useState(
    JSON.stringify(policy?.config ?? defaultConfigs.api_key, null, 2),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const toast = useToast();

  function selectType(next: PolicyType) {
    setType(next);
    if (!policy) setConfig(JSON.stringify(defaultConfigs[next], null, 2));
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const parsed = JSON.parse(config) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Configuration must be a JSON object.");
      await api(policy ? `/api/auth-policies/${policy.id}` : "/api/auth-policies", {
        method: policy ? "PATCH" : "POST",
        body: JSON.stringify({ name, type, config: parsed }),
      });
      setOpen(false);
      toast({
        title: policy
          ? "Authentication policy updated"
          : "Authentication policy created",
        description: "Deploy the Project to publish this draft change.",
        tone: "success",
      });
      onSaved();
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
        policy ? (
          <Button variant="ghost" size="icon" className="size-8" aria-label={`${readOnly ? "View" : "Edit"} ${policy.name}`}>
            {readOnly ? <Eye size={14} /> : <Pencil size={14} />}
          </Button>
        ) : (
          <Button size="sm">
            <Plus size={14} /> New policy
          </Button>
        )
      }
      title={policy ? `${readOnly ? "View" : "Edit"} authentication policy` : "New authentication policy"}
      description="Policies are reusable across endpoints. Credential fields reference environment Secrets by name."
    >
      <div className="space-y-4">
        <div>
          <label className="label">Policy name</label>
          <input
            className="field"
            value={name}
            disabled={readOnly}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label className="label">Provider type</label>
          <select
            className="field"
            value={type}
            disabled={readOnly}
            onChange={(event) => selectType(event.target.value as PolicyType)}
          >
            {policyTypes.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Configuration JSON</label>
          <textarea
            className="field min-h-64 font-mono text-xs"
            value={config}
            disabled={readOnly}
            spellCheck={false}
            onChange={(event) => setConfig(event.target.value)}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Use Secret names in <code>secretRef</code>; never paste a credential
            value into this configuration.
          </p>
        </div>
        {policy?.assignments.length ? (
          <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            Assigned to {policy.assignments.length} endpoint
            {policy.assignments.length === 1 ? "" : "s"}. Updates affect their
            next Project deployment.
          </p>
        ) : null}
        {error && <p className="text-xs text-red-500">{error}</p>}
        {!readOnly && (
          <Button
            loading={busy}
            disabled={!name.trim() || !config.trim()}
            onClick={() => void save()}
          >
            {policy ? "Save policy" : "Create policy"}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
