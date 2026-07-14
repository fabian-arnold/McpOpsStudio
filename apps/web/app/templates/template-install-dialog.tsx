"use client";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, Dialog, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useToast } from "@/components/providers";
import { PreviewResult } from "./template-preview";
import type { Policy, Preview, SafeSecret, Template } from "./template-types";

export function TemplateInstallDialog({
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
