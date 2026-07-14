"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, FolderKanban, Plus, Trash2 } from "lucide-react";
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
import type { ProjectSummary, SessionIdentity } from "@/lib/types";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>();
  const [identity, setIdentity] = useState<SessionIdentity["user"]>();
  const [loadError, setLoadError] = useState<string>();
  const load = useCallback(() => {
    setLoadError(undefined);
    Promise.all([
      api<ProjectSummary[]>("/api/projects"),
      api<SessionIdentity>("/api/auth/me"),
    ])
      .then(([items, session]) => {
        setProjects(items);
        setIdentity(session.user);
      })
      .catch((error) => setLoadError(errorMessage(error)));
  }, []);
  useEffect(load, [load]);
  async function select(project: ProjectSummary) {
    await api(`/api/projects/${project.id}/select`, { method: "POST", body: "{}" });
    window.location.assign("/mcp-endpoints");
  }
  if (loadError)
    return (
      <AppShell>
        <LoadError title="Projects unavailable" message={loadError} onRetry={load} />
      </AppShell>
    );
  const canManage = identity?.role === "owner" || identity?.role === "admin";
  return (
    <AppShell>
      <PageHeader
        eyebrow="Installation"
        title="Projects"
        description="Group environments, Functions, and runtime endpoints without a multitenant account model."
        actions={canManage ? <ProjectDialog onSaved={load} /> : undefined}
      />
      {!projects ? (
        <Skeleton className="h-80" />
      ) : projects.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((project) => {
            const selected = project.id === identity?.project.id;
            return (
              <article className="panel p-5" key={project.id}>
                <div className="flex items-start gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                    <FolderKanban size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-sm font-semibold hover:text-primary"
                      >
                        {project.name}
                      </Link>
                      <Badge tone={project.status === "active" ? "success" : "neutral"}>
                        {project.status}
                      </Badge>
                      {selected && <Badge tone="primary">selected</Badge>}
                    </div>
                    <code className="text-[10px] text-muted-foreground">
                      {project.slug}
                    </code>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {project.description || "No description"}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t pt-4 text-[11px] text-muted-foreground">
                  <span>
                    {project._count?.endpoints ?? 0} runtime endpoints ·{" "}
                    {project._count?.environments ?? 0} environments
                  </span>
                  <div className="flex gap-2">
                    {project.status === "active" && !selected && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void select(project)}
                      >
                        Select
                      </Button>
                    )}
                    {canManage && <ProjectDialog project={project} onSaved={load} />}
                    {canManage && (
                      <ProjectLifecycle
                        project={project}
                        selected={selected}
                        onSaved={load}
                      />
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<FolderKanban />}
          title="No projects"
          description="Create the first project to add environments, Functions, and runtime endpoints."
          action={canManage ? <ProjectDialog onSaved={load} /> : undefined}
        />
      )}
    </AppShell>
  );
}

function ProjectDialog({
  project,
  onSaved,
}: {
  project?: ProjectSummary;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project?.name ?? "");
  const [slug, setSlug] = useState(project?.slug ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await api(project ? `/api/projects/${project.id}` : "/api/projects", {
        method: project ? "PATCH" : "POST",
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim(),
        }),
      });
      toast({
        title: project ? "Project updated" : "Project created",
        tone: "success",
      });
      setOpen(false);
      onSaved();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" variant={project ? "ghost" : "primary"}>
          {project ? (
            "Edit"
          ) : (
            <>
              <Plus size={14} />
              New project
            </>
          )}
        </Button>
      }
      title={project ? "Edit project" : "Create project"}
      description="Projects own environments, Functions, runtime endpoints, secrets, policies, and libraries."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <label className="label">Name</label>
          <input
            className="field"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!project) setSlug(slugify(e.target.value));
            }}
            required
          />
        </div>
        <div>
          <label className="label">Slug</label>
          <input
            className="field font-mono"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea
            className="field min-h-20"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button loading={saving} type="submit">
            Save project
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ProjectLifecycle({
  project,
  selected,
  onSaved,
}: {
  project: ProjectSummary;
  selected: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function mutate(action: "archive" | "delete") {
    setBusy(true);
    setError(undefined);
    try {
      await api(
        `/api/projects/${project.id}${action === "archive" ? "/archive" : ""}`,
        {
          method: action === "archive" ? "POST" : "DELETE",
          ...(action === "archive" ? { body: "{}" } : {}),
        },
      );
      toast({
        title: action === "archive" ? "Project archived" : "Project deleted",
        tone: "success",
      });
      onSaved();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  if (selected) return null;
  const action = project.status === "active" ? "archive" : "delete";
  return (
    <Dialog
      trigger={
        <Button size="sm" variant={action === "delete" ? "danger" : "ghost"}>
          {action === "archive" ? <Archive size={13} /> : <Trash2 size={13} />}
          {action === "archive" ? "Archive" : "Delete"}
        </Button>
      }
      title={`${action === "archive" ? "Archive" : "Delete"} ${project.name}?`}
      description={
        action === "archive"
          ? "All project runtime endpoints will be disabled; history remains."
          : "Only an empty archived project can be permanently deleted."
      }
    >
      {error && <p className="mb-3 text-xs text-red-500">{error}</p>}
      <div className="flex justify-end">
        <Button variant="danger" loading={busy} onClick={() => void mutate(action)}>
          Confirm {action}
        </Button>
      </div>
    </Dialog>
  );
}
