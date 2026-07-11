"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Library, Plus } from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  EmptyState,
  LoadError,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type { ProjectLibrary } from "@/lib/types";

const editorLink =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition hover:brightness-110";

export default function ProjectLibrariesPage() {
  const [libraries, setLibraries] = useState<ProjectLibrary[]>();
  const [loadError, setLoadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const user = useCurrentUser();
  const canManage = roleAllows(user?.role, ["owner", "admin", "developer"]);
  const load = useCallback(() => {
    setLibraries(undefined);
    setLoadError(undefined);
    api<ProjectLibrary[]>("/api/libraries")
      .then(setLibraries)
      .catch((error) => setLoadError(errorMessage(error)));
  }, []);
  useEffect(load, [attempt, load]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Project"
        title="Libraries"
        description={`Versioned pure TypeScript utilities available to every endpoint in ${user?.project.name ?? "the selected project"}.`}
        actions={
          canManage ? (
            <Link href="/libraries/new" className={editorLink}>
              <Plus size={14} />
              New library
            </Link>
          ) : undefined
        }
      />
      {loadError ? (
        <LoadError
          title="Unable to load project libraries"
          message={loadError}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : !libraries ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : libraries.length ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="hidden grid-cols-[minmax(220px,1fr)_minmax(260px,1fr)_90px_120px] gap-4 border-b bg-muted/30 px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
            <span>Library</span>
            <span>Exports</span>
            <span>Version</span>
            <span />
          </div>
          {libraries.map((library) => (
            <div
              className="grid gap-4 border-b px-5 py-4 last:border-b-0 md:grid-cols-[minmax(220px,1fr)_minmax(260px,1fr)_90px_120px] md:items-center"
              key={library.id}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Library size={16} />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">
                    {library.name}
                  </h2>
                  <code className="block truncate text-[10px] text-muted-foreground">
                    {library.importPath}
                  </code>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {library.description || "No description provided."}
                  </p>
                </div>
              </div>
              <code className="truncate text-xs text-muted-foreground">
                {library.exportedFunctions?.join(", ") || "No declared exports"}
              </code>
              <Badge className="w-fit">v{library.version}</Badge>
              <Link
                href={`/libraries/${library.id}`}
                className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border bg-card px-3 text-xs font-medium hover:bg-muted"
              >
                Open editor <ArrowRight size={13} />
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Library />}
          title="No project libraries"
          description="Create a pure TypeScript utility library for functions in this project."
          action={
            canManage ? (
              <Link href="/libraries/new" className={editorLink}>
                <Plus size={14} /> New library
              </Link>
            ) : undefined
          }
        />
      )}
      <div className="mt-5 rounded-xl border p-4 text-xs text-muted-foreground">
        <strong className="text-foreground">Restricted pure code.</strong>{" "}
        Project libraries cannot access secrets, network, process, filesystem,
        child processes, or raw databases.
      </div>
    </AppShell>
  );
}
