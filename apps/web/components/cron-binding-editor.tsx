"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { EnvironmentSummary, OpsFunction } from "@/lib/types";

export type EditableCronBinding = {
  id: string;
  environmentId: string;
  functionId: string;
  name: string;
  expression: string;
  timezone: string;
  enabled: boolean;
  serviceSubject: string;
  permissionGrants: string[];
  networkPolicy?: {
    allowedHosts?: string[];
    allowedMethods?: string[];
    allowedPorts?: number[];
    allowPrivateHosts?: string[];
    allowInsecureTlsHosts?: string[];
    maxResponseBytes?: number;
  };
};

// This controlled form intentionally submits policy and schedule fields atomically.
// eslint-disable-next-line max-lines-per-function, complexity
export function CronBindingEditor({
  binding,
  environments,
  functions,
  fixedFunctionId,
  onSaved,
  onCancel,
}: {
  binding?: EditableCronBinding;
  environments: EnvironmentSummary[];
  functions: OpsFunction[];
  fixedFunctionId?: string;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const development = environments.find((item) => item.slug === "development");
  const initialFunctionId =
    fixedFunctionId ?? binding?.functionId ?? functions[0]?.id ?? "";
  const selectedFunction = functions.find((item) => item.id === initialFunctionId);
  const [form, setForm] = useState({
    environmentId:
      binding?.environmentId ?? development?.id ?? environments[0]?.id ?? "",
    functionId: initialFunctionId,
    name:
      binding?.name ?? (selectedFunction ? `${selectedFunction.name} schedule` : ""),
    expression: binding?.expression ?? "*/5 * * * *",
    timezone: binding?.timezone ?? "UTC",
    enabled: binding?.enabled ?? true,
    serviceSubject: binding?.serviceSubject ?? "cron-service",
    permissionGrants: (
      binding?.permissionGrants ??
      selectedFunction?.requiredPermissions ??
      []
    ).join(", "),
    allowedHosts: (binding?.networkPolicy?.allowedHosts ?? []).join(", "),
    allowedMethods: (binding?.networkPolicy?.allowedMethods ?? []).join(", "),
    allowedPorts: (binding?.networkPolicy?.allowedPorts ?? []).join(", "),
    allowPrivateHosts: (binding?.networkPolicy?.allowPrivateHosts ?? []).join(", "),
    allowInsecureTlsHosts: (binding?.networkPolicy?.allowInsecureTlsHosts ?? []).join(
      ", ",
    ),
    maxResponseBytes: binding?.networkPolicy?.maxResponseBytes ?? 1_048_576,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const required = useMemo(
    () =>
      functions.find((item) => item.id === form.functionId)?.requiredPermissions ?? [],
    [form.functionId, functions],
  );
  const list = (value: string) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const body = {
        environmentId: form.environmentId,
        functionId: form.functionId,
        name: form.name,
        expression: form.expression,
        timezone: form.timezone,
        enabled: form.enabled,
        serviceSubject: form.serviceSubject,
        permissionGrants: list(form.permissionGrants),
        networkPolicy: {
          allowedHosts: list(form.allowedHosts),
          allowedMethods: list(form.allowedMethods),
          allowedPorts: list(form.allowedPorts).map(Number),
          allowPrivateHosts: list(form.allowPrivateHosts),
          allowInsecureTlsHosts: list(form.allowInsecureTlsHosts),
          maxResponseBytes: Number(form.maxResponseBytes),
        },
      };
      await api(binding ? `/api/cron-bindings/${binding.id}` : "/api/cron-bindings", {
        method: binding ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      await onSaved();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const field = "field mt-1";
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold">
        {binding ? "Edit cron binding" : "Create cron binding"}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Five fields, minute-level precision. Input is always an empty object.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-xs">
          Name
          <input
            className={field}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label className="text-xs">
          Environment
          <select
            className={field}
            value={form.environmentId}
            onChange={(event) =>
              setForm({ ...form, environmentId: event.target.value })
            }
          >
            {environments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Function
          <select
            disabled={Boolean(fixedFunctionId)}
            className={field}
            value={form.functionId}
            onChange={(event) => {
              const functionId = event.target.value;
              const fn = functions.find((item) => item.id === functionId);
              setForm({
                ...form,
                functionId,
                permissionGrants: (fn?.requiredPermissions ?? []).join(", "),
              });
            }}
          >
            {functions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Service subject
          <input
            className={field}
            value={form.serviceSubject}
            onChange={(event) =>
              setForm({ ...form, serviceSubject: event.target.value })
            }
          />
        </label>
        <label className="text-xs">
          Cron expression
          <input
            className={`${field} font-mono`}
            value={form.expression}
            onChange={(event) => setForm({ ...form, expression: event.target.value })}
          />
        </label>
        <label className="text-xs">
          IANA timezone
          <input
            className={field}
            value={form.timezone}
            onChange={(event) => setForm({ ...form, timezone: event.target.value })}
          />
        </label>
        <label className="text-xs md:col-span-2">
          Permission grants
          <input
            className={field}
            value={form.permissionGrants}
            onChange={(event) =>
              setForm({ ...form, permissionGrants: event.target.value })
            }
          />
          <span className="mt-1 block text-[10px] text-muted-foreground">
            Required: {required.join(", ") || "none"}
          </span>
        </label>
        <label className="text-xs md:col-span-2">
          Allowed outbound hosts
          <input
            className={field}
            placeholder="api.example.com"
            value={form.allowedHosts}
            onChange={(event) => setForm({ ...form, allowedHosts: event.target.value })}
          />
        </label>
        <label className="text-xs">
          Allowed methods
          <input
            className={field}
            placeholder="GET, POST"
            value={form.allowedMethods}
            onChange={(event) =>
              setForm({ ...form, allowedMethods: event.target.value.toUpperCase() })
            }
          />
        </label>
        <label className="text-xs">
          Allowed ports
          <input
            className={field}
            placeholder="443"
            value={form.allowedPorts}
            onChange={(event) => setForm({ ...form, allowedPorts: event.target.value })}
          />
        </label>
        <label className="text-xs">
          Private-host exceptions
          <input
            className={field}
            value={form.allowPrivateHosts}
            onChange={(event) =>
              setForm({ ...form, allowPrivateHosts: event.target.value })
            }
          />
        </label>
        <label className="text-xs">
          Insecure-TLS exceptions
          <input
            className={field}
            value={form.allowInsecureTlsHosts}
            onChange={(event) =>
              setForm({ ...form, allowInsecureTlsHosts: event.target.value })
            }
          />
        </label>
        <label className="text-xs">
          Maximum response bytes
          <input
            className={field}
            type="number"
            value={form.maxResponseBytes}
            onChange={(event) =>
              setForm({ ...form, maxResponseBytes: Number(event.target.value) })
            }
          />
        </label>
        <label className="flex items-end gap-2 pb-2 text-xs">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
          />{" "}
          Enabled
        </label>
      </div>
      {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          loading={busy}
          disabled={!form.environmentId || !form.functionId || !form.name}
          onClick={() => void save()}
        >
          Save binding
        </Button>
      </div>
    </section>
  );
}
