"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Database,
  Globe2,
  KeyRound,
  RefreshCw,
  Search,
  ShieldCheck,
  Webhook,
  Wrench,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useToast } from "@/components/providers";

type Template = {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  secrets: string[];
  allowedHosts: string[];
  bindings: { mcp?: string; http?: { method: string; path: string } };
  fixtures: {
    version: number;
    items: {
      id: string;
      name: string;
      source: "mcp" | "http";
      input: unknown;
    }[];
  };
  availability: {
    status: "ready" | "requires_configuration" | "provider_unavailable";
    enabledByDefault: boolean;
    message: string;
    requiredCapabilities: string[];
  };
  documentation: {
    purpose: string;
    setup: string[];
    requirements: {
      secrets: string[];
      permissions: string[];
      networkHosts: string[];
      capabilities: string[];
    };
    exampleCalls: { source: string; input: unknown }[];
    expectedOutput: unknown;
    limitations: string[];
  };
  localExample?: boolean;
};
type RuntimeEndpoint = { id: string; name: string; environment?: { name?: string } };
type SafeSecret = {
  id: string;
  name: string;
  environmentId: string;
  grantCount?: number;
};
type Policy = {
  id: string;
  name: string;
  type: string;
  providerStatus?: string;
};
type Preview = {
  installable: boolean;
  blockers?: string[] | Record<string, unknown>;
  missingSecrets?: string[];
  missingHosts?: string[];
  missingCapabilities?: string[];
  policyBlockers?: string[];
  warnings?: string[];
  draft?: { enabled?: boolean; riskLevel?: string };
  exactChanges?: unknown;
};

const icons = {
  "http-api-proxy": Globe2,
  "postgres-read-query": Database,
  webhook: Webhook,
  "tenant-authorized": ShieldCheck,
  "read-search": Search,
  "confirmed-write": Wrench,
  "cache-lookup": Zap,
} as const;

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [endpoints, setEndpoints] = useState<RuntimeEndpoint[]>([]);
  const [endpointId, setEndpointId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const [catalog, endpointRows] = await Promise.all([
        api<Template[]>("/api/templates"),
        api<RuntimeEndpoint[]>("/api/runtime-endpoints"),
      ]);
      setTemplates(catalog);
      setEndpoints(endpointRows);
      setEndpointId((current) => current || endpointRows[0]?.id || "");
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === endpointId),
    [endpointId, endpoints],
  );
  return (
    <AppShell>
      <PageHeader
        eyebrow="Build"
        title="Operational templates"
        description="Complete operational units from the canonical server catalog, with configuration proven before installation."
      />
      <div className="panel mb-5 flex flex-wrap items-center gap-3 p-4">
        <label className="text-xs font-medium" htmlFor="template-endpoint">
          Install into
        </label>
        <select
          id="template-endpoint"
          className="field min-w-60"
          value={endpointId}
          onChange={(event) => setEndpointId(event.target.value)}
          disabled={loading || endpoints.length === 0}
        >
          {endpoints.length === 0 ? (
            <option value="">No endpoints available</option>
          ) : (
            endpoints.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.name}
                {endpoint.environment?.name ? ` · ${endpoint.environment.name}` : ""}
              </option>
            ))
          )}
        </select>
      </div>
      {loading && <Skeleton className="h-80" />}
      {loadError && (
        <div className="panel flex items-center justify-between gap-4 border-destructive/30 p-5">
          <div>
            <p className="text-sm font-medium">Template catalog unavailable</p>
            <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
          </div>
          <Button variant="secondary" onClick={() => void load()}>
            <RefreshCw size={13} />
            Retry
          </Button>
        </div>
      )}
      {!loading && !loadError && templates.length === 0 && (
        <EmptyState
          icon={<Wrench />}
          title="No published templates"
          description="This control plane did not return a template catalog."
        />
      )}
      {!loading && !loadError && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {templates.map((template) => (
            <TemplateCard
              template={template}
              endpointId={endpointId}
              endpointName={selectedEndpoint?.name}
              key={template.id}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function TemplateCard({
  template,
  endpointId,
  endpointName,
}: {
  template: Template;
  endpointId: string;
  endpointName: string | undefined;
}) {
  const Icon = icons[template.id as keyof typeof icons] ?? Wrench;
  const bindings = [
    template.bindings.mcp ? "MCP" : null,
    template.bindings.http ? "HTTP" : null,
  ].filter((value): value is string => Boolean(value));
  const unavailable = template.availability.status === "provider_unavailable";
  return (
    <article className="panel flex flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon size={18} />
        </span>
        <Badge
          tone={
            template.availability.status === "ready"
              ? "success"
              : template.availability.status === "requires_configuration"
                ? "warning"
                : "danger"
          }
        >
          {template.availability.status === "ready"
            ? "Ready to preview"
            : template.availability.status === "requires_configuration"
              ? "Setup required"
              : "Provider unavailable"}
        </Badge>
      </div>
      <h2 className="mt-4 text-sm font-semibold">{template.name}</h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {template.description}
      </p>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {template.availability.message}
      </p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {bindings.map((binding) => (
          <Badge tone={binding === "MCP" ? "primary" : "info"} key={binding}>
            {binding}
          </Badge>
        ))}
        <Badge>
          <KeyRound size={10} />
          {template.secrets.length} secrets
        </Badge>
        {template.localExample && <Badge tone="warning">Synthetic local example</Badge>}
      </div>
      <details className="mt-4 rounded-lg border p-3">
        <summary className="cursor-pointer text-xs font-semibold">
          Documentation and setup
        </summary>
        <div className="mt-3 space-y-4 text-[11px] leading-5 text-muted-foreground">
          <p>{template.documentation.purpose}</p>
          <DocList title="Setup" items={template.documentation.setup} />
          <DocList
            title="Permissions"
            items={template.documentation.requirements.permissions}
          />
          <DocList
            title="Secrets"
            items={template.documentation.requirements.secrets}
          />
          <DocList
            title="Network hosts"
            items={template.documentation.requirements.networkHosts}
          />
          <DocList
            title="Capabilities"
            items={template.documentation.requirements.capabilities}
          />
          <div>
            <p className="font-semibold text-foreground">Example calls</p>
            <pre className="mt-1 max-h-36 overflow-auto rounded bg-[#0b0d14] p-2 font-mono text-[9px] text-slate-300">
              {JSON.stringify(template.documentation.exampleCalls, null, 2)}
            </pre>
          </div>
          <div>
            <p className="font-semibold text-foreground">Expected output</p>
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-[#0b0d14] p-2 font-mono text-[9px] text-slate-300">
              {JSON.stringify(template.documentation.expectedOutput, null, 2)}
            </pre>
          </div>
          <DocList title="Limitations" items={template.documentation.limitations} />
        </div>
      </details>
      {unavailable ? (
        <Button
          variant="secondary"
          className="mt-5 w-full"
          disabled
          title={template.availability.message}
        >
          Provider unavailable
        </Button>
      ) : (
        <TemplateInstallDialog
          template={template}
          endpointId={endpointId}
          endpointName={endpointName}
        />
      )}
    </article>
  );
}

function TemplateInstallDialog({
  template,
  endpointId,
  endpointName,
}: {
  template: Template;
  endpointId: string;
  endpointName: string | undefined;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [secrets, setSecrets] = useState<SafeSecret[]>();
  const [policies, setPolicies] = useState<Policy[]>();
  const [network, setNetwork] = useState<unknown>();
  const [capabilities, setCapabilities] = useState<unknown>();
  const [secretGrants, setSecretGrants] = useState<Record<string, string>>({});
  const [authPolicyId, setAuthPolicyId] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [previewKey, setPreviewKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string>();
  const selectionKey = JSON.stringify({
    secretGrants,
    authPolicyId: authPolicyId || undefined,
  });
  const previewCurrent: Preview | undefined =
    preview && previewKey === selectionKey ? preview : undefined;
  useEffect(() => {
    if (!open || !endpointId) return;
    setLoading(true);
    setFormError(undefined);
    Promise.all([
      api<SafeSecret[]>("/api/secrets"),
      api<Policy[]>("/api/auth-policies"),
      api(`/api/runtime-endpoints/${endpointId}/network-policy`),
      api("/api/capabilities"),
    ])
      .then(([secretRows, policyRows, networkState, capabilityState]) => {
        setSecrets(secretRows);
        setPolicies(policyRows);
        setNetwork(networkState);
        setCapabilities(capabilityState);
        setSecretGrants(
          Object.fromEntries(
            template.secrets.map((name) => [
              name,
              secretRows.find((secret) => secret.name === name)?.id ?? "",
            ]),
          ),
        );
      })
      .catch((error) => setFormError(errorMessage(error)))
      .finally(() => setLoading(false));
  }, [open, endpointId, template.secrets]);
  async function runPreview() {
    setSaving(true);
    setFormError(undefined);
    try {
      const body = { secretGrants, ...(authPolicyId ? { authPolicyId } : {}) };
      const result = await api<Preview>(
        `/api/runtime-endpoints/${endpointId}/templates/${template.id}/preview`,
        { method: "POST", body: JSON.stringify(body) },
      );
      setPreview(result);
      setPreviewKey(JSON.stringify(body));
    } catch (error) {
      setPreview(undefined);
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  async function install() {
    if (!previewCurrent?.installable) return;
    setSaving(true);
    setFormError(undefined);
    try {
      const body = { secretGrants, ...(authPolicyId ? { authPolicyId } : {}) };
      const result = await api<{
        function?: { id?: string; name?: string; enabled?: boolean };
        enabled?: boolean;
      }>(`/api/runtime-endpoints/${endpointId}/templates/${template.id}/install`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const enabled =
        result.function?.enabled ?? result.enabled ?? previewCurrent.draft?.enabled;
      toast({
        title: "Template installed",
        description: `${template.name} was added to ${endpointName ?? "the endpoint"} as an ${enabled ? "enabled" : "disabled"} draft.`,
        tone: "success",
      });
      setOpen(false);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPreview(undefined);
          setFormError(undefined);
        }
      }}
      trigger={
        <Button variant="secondary" className="mt-5 w-full" disabled={!endpointId}>
          Configure and preview <ArrowRight size={13} />
        </Button>
      }
      title={`Configure ${template.name}`}
      description="The server validates secret grants, policy, network hosts, capabilities, and enabled state before installation."
    >
      {loading ? (
        <Skeleton className="h-72" />
      ) : (
        <div className="space-y-4">
          {template.secrets.map((name) => (
            <div key={name}>
              <label className="label">Secret grant: {name}</label>
              <select
                className="field font-mono"
                value={secretGrants[name] ?? ""}
                onChange={(event) => {
                  setSecretGrants((current) => ({
                    ...current,
                    [name]: event.target.value,
                  }));
                  setPreview(undefined);
                }}
              >
                <option value="">Missing — create or select a secret</option>
                {secrets?.map((secret) => (
                  <option value={secret.id} key={secret.id}>
                    {secret.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div>
            <label className="label">Route authentication policy</label>
            <select
              className="field"
              value={authPolicyId}
              onChange={(event) => {
                setAuthPolicyId(event.target.value);
                setPreview(undefined);
              }}
            >
              <option value="">No explicit policy selection</option>
              {policies
                ?.filter((policy) => policy.providerStatus !== "deferred")
                .map((policy) => (
                  <option value={policy.id} key={policy.id}>
                    {policy.name} · {policy.type}
                  </option>
                ))}
            </select>
          </div>
          <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 text-[10px] text-muted-foreground sm:grid-cols-2">
            <span>Network state: {network ? "loaded" : "unavailable"}</span>
            <span>Capability state: {capabilities ? "loaded" : "unavailable"}</span>
          </div>
          {formError && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400"
            >
              {formError}
            </div>
          )}
          <Button
            className="w-full"
            variant="secondary"
            loading={saving}
            onClick={runPreview}
          >
            Run exact installation preview
          </Button>
          {previewCurrent && <PreviewResult preview={previewCurrent} />}
          {previewCurrent?.installable && (
            <Button className="w-full" loading={saving} onClick={install}>
              Install confirmed {previewCurrent.draft?.enabled ? "enabled" : "disabled"}{" "}
              draft
            </Button>
          )}
        </div>
      )}
    </Dialog>
  );
}

function PreviewResult({ preview }: { preview: Preview }) {
  const knownBlockers = [
    ...(preview.missingSecrets ?? []).map((value) => `Missing secret: ${value}`),
    ...(preview.missingHosts ?? []).map((value) => `Missing allowed host: ${value}`),
    ...(preview.missingCapabilities ?? []).map(
      (value) => `Missing capability: ${value}`,
    ),
    ...(preview.policyBlockers ?? []),
  ];
  return (
    <div
      className={
        preview.installable
          ? "rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4"
          : "rounded-lg border border-amber-500/20 bg-amber-500/5 p-4"
      }
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">
          {preview.installable ? "Installation is ready" : "Installation is blocked"}
        </p>
        <Badge tone={preview.installable ? "success" : "warning"}>
          {preview.draft?.enabled ? "Enabled draft" : "Disabled draft"}
        </Badge>
      </div>
      {knownBlockers.length > 0 && (
        <ul className="mt-3 list-inside list-disc text-[11px] text-muted-foreground">
          {knownBlockers.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {preview.warnings?.length ? (
        <ul className="mt-3 list-inside list-disc text-[11px] text-muted-foreground">
          {preview.warnings.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer text-[10px] font-medium">
          Exact server preview
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-[#0b0d14] p-2 font-mono text-[9px] text-slate-300">
          {JSON.stringify(preview.exactChanges ?? preview.blockers ?? preview, null, 2)}
        </pre>
      </details>
    </div>
  );
}
function DocList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="font-semibold text-foreground">{title}</p>
      <ul className="mt-1 list-inside list-disc">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
