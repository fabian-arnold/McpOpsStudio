"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Circle, FileCode2, Library, Save } from "lucide-react";
import { AppShell } from "@/components/shell";
import { TypeScriptEditor } from "@/components/typescript-editor";
import { Badge, Button, LoadError, Skeleton } from "@/components/ui";
import { useToast } from "@/components/providers";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type { ProjectLibrary } from "@/lib/types";

type LibraryDraft = {
  name: string;
  importPath: string;
  description: string;
  code: string;
  exportedFunctions: string;
};

const blankLibrary: LibraryDraft = {
  name: "",
  importPath: "@mcpops/lib/",
  description: "",
  code: "export function utility(value: unknown) {\n  return value;\n}\n",
  exportedFunctions: "utility",
};

export default function LibraryEditorPage() {
  const { libraryId } = useParams<{ libraryId: string }>();
  const router = useRouter();
  const toast = useToast();
  const user = useCurrentUser();
  const canManage = roleAllows(user?.role, ["owner", "admin", "developer"]);
  const [library, setLibrary] = useState<ProjectLibrary>();
  const [libraries, setLibraries] = useState<ProjectLibrary[]>([]);
  const [versions, setVersions] = useState<ProjectLibrary[]>([]);
  const [draft, setDraft] = useState<LibraryDraft>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      const all = await api<ProjectLibrary[]>("/api/libraries");
      setLibraries(all);
      if (libraryId === "new") {
        setLibrary(undefined);
        setVersions([]);
        setDraft(blankLibrary);
        return;
      }
      const current = all.find((item) => item.id === libraryId);
      if (!current)
        throw new Error("Library not found in the selected project");
      const history = await api<ProjectLibrary[]>(
        `/api/libraries/${current.id}/versions`,
      );
      setLibrary(current);
      setVersions(history);
      setDraft({
        name: current.name,
        importPath: current.importPath,
        description: current.description,
        code: current.code ?? "",
        exportedFunctions: current.exportedFunctions?.join(", ") ?? "",
      });
      setDirty(false);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [libraryId]);
  useEffect(() => void load(), [attempt, load]);

  const update = (patch: Partial<LibraryDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  };

  const exportedFunctions = useMemo(
    () =>
      draft?.exportedFunctions
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean) ?? [],
    [draft?.exportedFunctions],
  );

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const created = await api<ProjectLibrary>("/api/libraries", {
        method: "POST",
        body: JSON.stringify({ ...draft, exportedFunctions }),
      });
      setLibrary(created);
      setDirty(false);
      toast({
        title: `Library version ${created.version} created`,
        description:
          "The immutable version is available to future deployment builds.",
        tone: "success",
      });
      router.replace(`/libraries/${created.id}`);
    } catch (error) {
      toast({
        title: "Library was not saved",
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
          title="Unable to open the library editor"
          message={loadError}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </AppShell>
    );
  if (!draft)
    return (
      <AppShell>
        <Skeleton className="h-[80vh]" />
      </AppShell>
    );

  return (
    <AppShell>
      <div className="-m-4 sm:-m-6 lg:-m-8">
        <header className="flex min-h-14 flex-col gap-3 border-b bg-card px-4 py-2.5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <Link
              href="/libraries"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft size={13} /> Libraries
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="truncate font-mono font-medium">
              {draft.importPath === "@mcpops/lib/"
                ? "New library"
                : draft.importPath}
            </span>
            {library && <Badge>v{library.version}</Badge>}
            {dirty && (
              <Badge tone="warning">
                <Circle size={7} fill="currentColor" /> Unsaved
              </Badge>
            )}
          </div>
          <Button
            className="ml-auto"
            size="sm"
            onClick={save}
            loading={saving}
            disabled={
              !canManage || !draft.name || !draft.importPath || !draft.code
            }
          >
            <Save size={13} /> Validate and save version
          </Button>
        </header>
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/8 px-4 py-2 text-[10px] text-amber-800 dark:text-amber-200">
          <Library size={12} />
          <strong>Restricted pure code:</strong> no runtime context, secrets,
          network, process, filesystem, dynamic imports, or packages.
        </div>
        <div className="grid min-h-[calc(100vh-174px)] grid-cols-1 xl:grid-cols-[260px_minmax(520px,1fr)_260px]">
          <aside className="border-r bg-card p-4">
            <h2 className="mb-4 text-xs font-semibold">Library settings</h2>
            <Field label="Name">
              <input
                className="field"
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
                disabled={!canManage}
              />
            </Field>
            <Field label="Import path">
              <input
                className="field font-mono"
                value={draft.importPath}
                onChange={(event) => update({ importPath: event.target.value })}
                pattern="@mcpops/lib/[a-z0-9]+(?:-[a-z0-9]+)*"
                readOnly={Boolean(library) || !canManage}
              />
            </Field>
            <Field label="Description">
              <textarea
                className="field min-h-24"
                value={draft.description}
                onChange={(event) =>
                  update({ description: event.target.value })
                }
                disabled={!canManage}
              />
            </Field>
            <Field
              label="Exported functions"
              hint="Comma separated; used for import autocomplete."
            >
              <input
                className="field font-mono"
                value={draft.exportedFunctions}
                onChange={(event) =>
                  update({ exportedFunctions: event.target.value })
                }
                disabled={!canManage}
              />
            </Field>
          </aside>
          <section className="flex min-w-0 flex-col border-r">
            <div className="flex h-10 items-center gap-2 border-b bg-card px-3 text-[11px]">
              <FileCode2 size={13} /> {draft.name || "library"}.ts
            </div>
            <div className="min-h-[580px] flex-1 bg-card">
              <TypeScriptEditor
                path={`file:///libraries/${draft.importPath.replace(/[^a-z0-9-]/gi, "-") || "new"}.ts`}
                value={draft.code}
                onChange={(code) => update({ code })}
                libraries={libraries.filter(
                  (item) => item.importPath !== draft.importPath,
                )}
                readOnly={!canManage}
              />
            </div>
          </section>
          <aside className="bg-card p-4">
            <h2 className="text-xs font-semibold">Immutable versions</h2>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Saving always creates a new version.
            </p>
            <div className="mt-4 space-y-2">
              {versions.length ? (
                versions.map((version) => (
                  <div className="rounded-lg border p-3" key={version.id}>
                    <div className="flex items-center justify-between text-xs font-medium">
                      Version {version.version}
                      {version.id === library?.id && (
                        <Badge tone="primary">Current</Badge>
                      )}
                    </div>
                    <code className="mt-2 block truncate text-[10px] text-muted-foreground">
                      {version.exportedFunctions?.join(", ") ||
                        "No declared exports"}
                    </code>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                  No saved versions yet.
                </p>
              )}
            </div>
            <div className="mt-5 rounded-lg bg-muted/50 p-3 text-[10px] leading-5 text-muted-foreground">
              Functions can import declared exports from{" "}
              <code className="text-foreground">{draft.importPath}</code>.
              Deploy a endpoint to pin the library version into its immutable
              snapshot.
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-4 block">
      <span className="label">{label}</span>
      {children}
      {hint && (
        <span className="mt-1 block text-[10px] text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}
