"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Bug, FolderCog, ScrollText, Trash2 } from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  Button,
  Dialog,
  LoadError,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/providers";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";

type ProjectSettings = {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  captureDevelopmentPayloads: boolean;
  logging: {
    development: LogSettings;
    production: LogSettings;
  };
};
type LogSettings = {
  level: "debug" | "info" | "warn" | "error" | "off";
  retentionDays: number;
  retentionMaxEntries: number;
  retentionMaxBytes: number;
};

export default function ProjectSettingsPage() {
  const toast = useToast();
  const user = useCurrentUser();
  const canManage = roleAllows(user?.role, ["owner", "admin"]);
  const [settings, setSettings] = useState<ProjectSettings>();
  const [draft, setDraft] = useState<ProjectSettings>();
  const [loadError, setLoadError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const value = await api<ProjectSettings>("/api/project-settings");
      setSettings(value);
      setDraft(value);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      await api("/api/project-settings", {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name.trim(),
          slug: draft.slug.trim(),
          description: draft.description.trim(),
          captureDevelopmentPayloads: draft.captureDevelopmentPayloads,
          logging: draft.logging,
        }),
      });
      toast({
        title: "Project settings saved",
        description: draft.captureDevelopmentPayloads
          ? "Future Development executions will retain redacted input and output."
          : "Future Development executions will omit input and output bodies.",
        tone: "success",
      });
      window.location.reload();
    } catch (error) {
      toast({
        title: "Project settings were not saved",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loadError)
    return (
      <AppShell>
        <LoadError
          title="Project settings unavailable"
          message={loadError}
          onRetry={() => void load()}
        />
      </AppShell>
    );
  if (!draft || !settings)
    return (
      <AppShell>
        <Skeleton className="h-96" />
      </AppShell>
    );

  return (
    <AppShell>
      <PageHeader
        eyebrow="Project"
        title="Project settings"
        description="Manage the selected Project and its Development debugging behavior."
      />
      <form onSubmit={save} className="space-y-6">
        <section className="panel p-5">
          <div className="flex items-center gap-2">
            <FolderCog size={16} className="text-primary" />
            <h2 className="text-sm font-semibold">General</h2>
            <Badge className="ml-auto">{settings.status}</Badge>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <label>
              <span className="label">Project name</span>
              <input
                className="field"
                value={draft.name}
                disabled={!canManage}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                required
              />
            </label>
            <label>
              <span className="label">Project slug</span>
              <input
                className="field font-mono"
                value={draft.slug}
                disabled={!canManage}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
                required
              />
              <span className="mt-1 block text-[10px] text-muted-foreground">
                Changing the slug changes all MCP and HTTP endpoint URLs.
              </span>
            </label>
          </div>
          <label className="mt-4 block">
            <span className="label">Description</span>
            <textarea
              className="field min-h-24"
              value={draft.description}
              disabled={!canManage}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </label>
        </section>

        <section className="panel p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <ScrollText size={16} />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Runtime logging</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Set the project-wide minimum level and Graylog-style retention limits
                independently for each environment.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <LoggingEnvironmentSettings
              label="Development"
              value={draft.logging.development}
              disabled={!canManage}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  logging: { ...draft.logging, development: value },
                })
              }
            />
            <LoggingEnvironmentSettings
              label="Production"
              value={draft.logging.production}
              disabled={!canManage}
              onChange={(value) =>
                setDraft({ ...draft, logging: { ...draft.logging, production: value } })
              }
            />
          </div>
          <p className="mt-4 rounded-lg border bg-muted/30 p-3 text-[11px] leading-5 text-muted-foreground">
            The oldest entries are removed when any limit is exceeded. Log metadata is
            redacted and bounded before storage; changing these settings never weakens
            Secret redaction.
          </p>
        </section>

        <section className="panel p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Bug size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Development payload capture</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Retain redacted Function input and output for future Development
                    executions so they can be inspected on the Executions page.
                  </p>
                </div>
                <div className="inline-flex items-center gap-3 text-xs font-medium">
                  <button
                    type="button"
                    role="switch"
                    aria-label="Development payload capture"
                    aria-checked={draft.captureDevelopmentPayloads}
                    disabled={!canManage}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        captureDevelopmentPayloads: !draft.captureDevelopmentPayloads,
                      })
                    }
                    className={`relative h-7 w-12 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                      draft.captureDevelopmentPayloads
                        ? "border-primary bg-primary"
                        : "border-border bg-muted"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-background shadow-sm transition-transform ${
                        draft.captureDevelopmentPayloads
                          ? "translate-x-6"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                  <span>
                    {draft.captureDevelopmentPayloads ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] leading-5 text-muted-foreground">
                Development only. Production payloads are never captured. Sensitive keys
                and known Secret values remain redacted, and oversized payloads are
                truncated to a bounded preview.
              </div>
            </div>
          </div>
        </section>

        {canManage && (
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Save project settings
            </Button>
          </div>
        )}
      </form>

      {canManage && <DeleteProject project={settings} />}
    </AppShell>
  );
}

function LoggingEnvironmentSettings({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: LogSettings;
  disabled: boolean;
  onChange: (value: LogSettings) => void;
}) {
  return (
    <div className="rounded-xl border p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs font-semibold">{label}</h3>
        <Badge
          tone={
            value.level === "off"
              ? "neutral"
              : value.level === "debug"
                ? "warning"
                : "primary"
          }
        >
          {value.level}
        </Badge>
      </div>
      <label>
        <span className="label">Minimum level</span>
        <select
          className="field"
          value={value.level}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, level: event.target.value as LogSettings["level"] })
          }
        >
          {["debug", "info", "warn", "error", "off"].map((level) => (
            <option key={level} value={level}>
              {level === "off" ? "Off — store no Function logs" : `${level} and above`}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <label>
          <span className="label">Max age</span>
          <input
            className="field"
            type="number"
            min={1}
            max={3650}
            value={value.retentionDays}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, retentionDays: Number(event.target.value) })
            }
          />
          <span className="mt-1 block text-[9px] text-muted-foreground">days</span>
        </label>
        <label>
          <span className="label">Max count</span>
          <input
            className="field"
            type="number"
            min={100}
            max={10000000}
            step={100}
            value={value.retentionMaxEntries}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, retentionMaxEntries: Number(event.target.value) })
            }
          />
          <span className="mt-1 block text-[9px] text-muted-foreground">entries</span>
        </label>
        <label>
          <span className="label">Max size</span>
          <input
            className="field"
            type="number"
            min={1}
            max={1907}
            value={Math.round(value.retentionMaxBytes / 1048576)}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...value,
                retentionMaxBytes: Number(event.target.value) * 1048576,
              })
            }
          />
          <span className="mt-1 block text-[9px] text-muted-foreground">MiB</span>
        </label>
      </div>
    </div>
  );
}

function DeleteProject({ project }: { project: ProjectSettings }) {
  const toast = useToast();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await api("/api/project-settings", {
        method: "DELETE",
        body: JSON.stringify({ confirmation }),
      });
      toast({ title: "Project deleted", tone: "success" });
      window.location.assign("/");
    } catch (error) {
      toast({
        title: "Project was not deleted",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-8 rounded-xl border border-red-500/25 bg-red-500/5 p-5">
      <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">
        Delete Project
      </h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Permanently deletes endpoints, Functions, Secrets, deployments, and execution
        history. Another active Project must exist.
      </p>
      <Dialog
        trigger={
          <Button className="mt-4" variant="danger">
            <Trash2 size={13} /> Delete Project
          </Button>
        }
        title={`Delete ${project.name}?`}
        description="This operation cannot be undone."
      >
        <label>
          <span className="label">
            Enter <code>{project.slug}</code> to confirm
          </span>
          <input
            className="field font-mono"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        <div className="mt-5 flex justify-end">
          <Button
            variant="danger"
            loading={busy}
            disabled={confirmation !== project.slug}
            onClick={() => void remove()}
          >
            Permanently delete Project
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
