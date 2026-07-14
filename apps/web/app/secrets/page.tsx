"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, LockKeyhole, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import type { EnvironmentSummary } from "@/lib/types";

type ProjectSecret = {
  id: string;
  name: string;
  environmentId: string;
  createdAt: string;
  updatedAt: string;
  grantCount: number;
  usage: Array<{ functionId: string; functionName: string }>;
};

type SecretPair = {
  name: string;
  development?: ProjectSecret;
  production?: ProjectSecret;
  grantCount: number;
  usage: Array<{ functionId: string; functionName: string }>;
  updatedAt: string;
};

export default function SecretsPage() {
  const user = useCurrentUser();
  const canManage = roleAllows(user?.role, ["owner", "admin"]);
  const [secrets, setSecrets] = useState<ProjectSecret[]>();
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>();
  const [loadError, setLoadError] = useState<string>();
  const [revision, setRevision] = useState(0);

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      const [secretRows, environmentRows] = await Promise.all([
        api<ProjectSecret[]>("/api/secrets"),
        api<EnvironmentSummary[]>("/api/environments"),
      ]);
      setSecrets(secretRows);
      setEnvironments(environmentRows);
    } catch (reason) {
      setLoadError(errorMessage(reason));
    }
  }, []);
  useEffect(() => void load(), [load, revision]);

  const pairs = useMemo(
    () => groupSecrets(secrets ?? [], environments ?? []),
    [environments, secrets],
  );
  const hasRequiredEnvironments =
    environments?.some((environment) => environment.slug === "development") &&
    environments.some((environment) => environment.slug === "production");

  return (
    <AppShell>
      <PageHeader
        eyebrow="Project"
        title="Secrets"
        description={`Synchronized Development and Production credentials for ${user?.project.name ?? "the selected project"}. Each environment keeps its own encrypted, write-only value.`}
        actions={
          canManage && hasRequiredEnvironments ? (
            <SecretValuesDialog onSaved={() => setRevision((value) => value + 1)} />
          ) : undefined
        }
      />
      {loadError ? (
        <LoadError
          title="Unable to load project Secrets"
          message={loadError}
          onRetry={() => setRevision((value) => value + 1)}
        />
      ) : !secrets || !environments ? (
        <Skeleton className="h-72" />
      ) : !hasRequiredEnvironments ? (
        <LoadError
          title="Development and Production are required"
          message="Create both Project environments before managing synchronized Secrets."
          onRetry={() => setRevision((value) => value + 1)}
        />
      ) : pairs.length ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="hidden grid-cols-[minmax(220px,1fr)_150px_150px_minmax(180px,1fr)_170px_110px] gap-4 border-b bg-muted/30 px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
            <span>Secret</span>
            <span>Development</span>
            <span>Production</span>
            <span>Function usage</span>
            <span>Last changed</span>
            <span />
          </div>
          {pairs.map((pair) => (
            <SecretRow
              key={pair.name}
              pair={pair}
              canManage={canManage}
              onChanged={() => setRevision((value) => value + 1)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<LockKeyhole />}
          title="No project Secrets"
          description="Create one Secret name with separate encrypted values for Development and Production."
          action={
            canManage ? (
              <SecretValuesDialog onSaved={() => setRevision((value) => value + 1)} />
            ) : undefined
          }
        />
      )}
    </AppShell>
  );
}

function SecretRow({
  pair,
  canManage,
  onChanged,
}: {
  pair: SecretPair;
  canManage: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!window.confirm(`Delete "${pair.name}" from Development and Production?`))
      return;
    setDeleting(true);
    try {
      await api(`/api/secrets/sync/${encodeURIComponent(pair.name)}`, {
        method: "DELETE",
      });
      toast({
        title: "Secret deleted",
        description: `${pair.name} was removed from both environments.`,
        tone: "success",
      });
      onChanged();
    } catch (reason) {
      toast({
        title: "Secret was not deleted",
        description: errorMessage(reason),
        tone: "error",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="grid gap-4 border-b px-5 py-4 last:border-b-0 md:grid-cols-[minmax(220px,1fr)_150px_150px_minmax(180px,1fr)_170px_110px] md:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <KeyRound size={16} />
        </span>
        <div className="min-w-0">
          <code className="block truncate text-xs font-semibold">{pair.name}</code>
          <span className="text-[10px] text-muted-foreground">
            Encrypted - values hidden
          </span>
        </div>
      </div>
      <EnvironmentStatus configured={Boolean(pair.development)} />
      <EnvironmentStatus configured={Boolean(pair.production)} />
      <div className="flex flex-wrap gap-1.5">
        {pair.usage.length ? (
          pair.usage.map((usage) => (
            <Badge key={usage.functionId} tone="neutral">
              {usage.functionName}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No Function grants</span>
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {new Date(pair.updatedAt).toLocaleString()}
      </span>
      {canManage && (
        <div className="flex justify-end gap-1">
          <SecretValuesDialog pair={pair} onSaved={onChanged} />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-red-500"
            loading={deleting}
            disabled={pair.grantCount > 0}
            title={
              pair.grantCount
                ? "Remove all Function grants before deleting this Secret"
                : "Delete Secret from both environments"
            }
            onClick={() => void remove()}
            aria-label={`Delete ${pair.name}`}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}

function EnvironmentStatus({ configured }: { configured: boolean }) {
  return (
    <Badge className="w-fit" tone={configured ? "success" : "warning"}>
      {configured ? "Configured" : "Missing"}
    </Badge>
  );
}

function SecretValuesDialog({
  pair,
  onSaved,
}: {
  pair?: SecretPair;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(pair?.name ?? "");
  const [developmentValue, setDevelopmentValue] = useState("");
  const [productionValue, setProductionValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const toast = useToast();

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await api("/api/secrets/sync", {
        method: "POST",
        body: JSON.stringify({ name, developmentValue, productionValue }),
      });
      setOpen(false);
      setDevelopmentValue("");
      setProductionValue("");
      if (!pair) setName("");
      toast({
        title: pair ? "Secret rotated" : "Secret created",
        description:
          "Development and Production values were stored together and will not be shown again.",
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
        pair ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Rotate ${pair.name}`}
          >
            <RefreshCw size={14} />
          </Button>
        ) : (
          <Button size="sm">
            <Plus size={14} /> New Secret
          </Button>
        )
      }
      title={pair ? `Rotate ${pair.name}` : "New project Secret"}
      description="Enter separate write-only values. Both environments are updated atomically."
    >
      <div className="space-y-4">
        <div>
          <label className="label">Secret name</label>
          <input
            className="field font-mono"
            value={name}
            disabled={Boolean(pair)}
            onChange={(event) => setName(event.target.value.toUpperCase())}
            placeholder="CUSTOMER_API_KEY"
          />
        </div>
        <SecretValueInput
          label="Development value"
          value={developmentValue}
          onChange={setDevelopmentValue}
        />
        <SecretValueInput
          label="Production value"
          value={productionValue}
          onChange={setProductionValue}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <Button
          loading={busy}
          disabled={!name || !developmentValue || !productionValue}
          onClick={() => void save()}
        >
          {pair ? "Rotate both values" : "Create in both environments"}
        </Button>
      </div>
    </Dialog>
  );
}

function SecretValueInput({
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
      <input
        className="field"
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Stored encrypted and never shown again"
      />
    </div>
  );
}

function groupSecrets(
  secrets: ProjectSecret[],
  environments: EnvironmentSummary[],
): SecretPair[] {
  const slugById = new Map(
    environments.map((environment) => [environment.id, environment.slug]),
  );
  const groups = new Map<string, SecretPair>();
  for (const secret of secrets) {
    const current = groups.get(secret.name) ?? {
      name: secret.name,
      grantCount: 0,
      usage: [],
      updatedAt: secret.updatedAt ?? secret.createdAt,
    };
    const slug = slugById.get(secret.environmentId);
    if (slug === "development") current.development = secret;
    if (slug === "production") current.production = secret;
    current.grantCount = Math.max(current.grantCount, secret.grantCount ?? 0);
    current.updatedAt =
      new Date(current.updatedAt) > new Date(secret.updatedAt ?? secret.createdAt)
        ? current.updatedAt
        : (secret.updatedAt ?? secret.createdAt);
    const usageById = new Map(
      [...current.usage, ...secret.usage].map((usage) => [usage.functionId, usage]),
    );
    current.usage = [...usageById.values()];
    groups.set(secret.name, current);
  }
  return [...groups.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}
