"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, LockKeyhole, Settings, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  LoadError,
  PageHeader,
  Skeleton,
  UnavailableValue,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Capabilities = {
  environment?: string;
  executor?: {
    provider: string;
    hostileCodeIsolation: boolean;
  };
  authProviders?: {
    localPassword?: "enabled" | "disabled";
    jwt?: "enabled" | "disabled";
    entraRuntime?: "enabled" | "disabled";
    webhookSignature?: "enabled" | "disabled";
  };
  runtimeCapabilities?: { arbitraryPackageInstallation?: boolean };
};

export default function SettingsPage() {
  const [data, setData] = useState<Capabilities>();
  const [loadError, setLoadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => {
    setData(undefined);
    setLoadError(undefined);
    api<Capabilities>("/api/capabilities")
      .then(setData)
      .catch((error) => setLoadError(errorMessage(error)));
  }, []);
  useEffect(load, [attempt, load]);
  if (loadError)
    return (
      <AppShell>
        <PageHeader
          eyebrow="Platform"
          title="Platform settings"
          description="Server-reported security posture and authentication capabilities."
        />
        <LoadError
          title="Capabilities unavailable"
          message={loadError}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </AppShell>
    );
  if (!data)
    return (
      <AppShell>
        <Skeleton className="h-96" />
      </AppShell>
    );
  return (
    <AppShell>
      <PageHeader
        eyebrow="Platform"
        title="Platform settings"
        description="Server-reported security posture and authentication capabilities."
      />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <section className="panel p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-primary" />
              <h2 className="text-sm font-semibold">Control-plane authentication</h2>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="text-xs font-semibold">Local email and password</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  Project-scoped platform login with secure sessions. No enterprise SSO
                  provider lifecycle is configured.
                </p>
              </div>
              <Badge
                tone={
                  data.authProviders?.localPassword === "enabled"
                    ? "success"
                    : "warning"
                }
              >
                {data.authProviders?.localPassword ?? "Not reported"}
              </Badge>
            </div>
          </section>
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Runtime endpoint authentication</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              These capabilities validate callers to deployed MCP and HTTP endpoints.
              They do not sign users into the control plane.
            </p>
            <div className="mt-4 divide-y">
              {[
                ["JWT validation", data.authProviders?.jwt],
                [
                  "Microsoft Entra runtime validation",
                  data.authProviders?.entraRuntime,
                ],
                ["Webhook signatures", data.authProviders?.webhookSignature],
              ].map(([name, status]) => (
                <div className="flex items-center justify-between py-3" key={name}>
                  <span className="text-xs">{name}</span>
                  <Badge tone={status === "enabled" ? "success" : "neutral"}>
                    {status ?? "Not reported"}
                  </Badge>
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className="space-y-5">
          <section className="panel p-5">
            <div className="flex items-center gap-2">
              <Settings size={16} className="text-primary" />
              <h2 className="text-sm font-semibold">Runtime mode</h2>
            </div>
            <dl className="mt-4 space-y-3 text-xs">
              <Capability label="Environment" value={data.environment} />
              <Capability label="Execution provider" value={data.executor?.provider} />
              <Capability
                label="Package installation"
                value={
                  data.runtimeCapabilities?.arbitraryPackageInstallation === undefined
                    ? undefined
                    : data.runtimeCapabilities.arbitraryPackageInstallation
                      ? "Enabled"
                      : "Disabled"
                }
              />
            </dl>
          </section>
          <section className="panel p-5">
            <div className="flex items-center gap-2">
              <KeyRound size={16} className="text-primary" />
              <h2 className="text-sm font-semibold">Secret protection</h2>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              <LockKeyhole className="mr-1 inline" size={13} />
              Runtime and platform secrets are write-only and are never rendered after
              creation.
            </p>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
function Capability({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value ?? <UnavailableValue />}</dd>
    </div>
  );
}
