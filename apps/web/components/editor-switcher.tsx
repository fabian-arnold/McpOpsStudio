"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Code2, Library, Plus } from "lucide-react";
import type { OpsFunction, ProjectLibrary } from "@/lib/types";

export function EditorSwitcher({
  functions,
  libraries,
  active,
  dirty,
  canManage,
}: {
  functions: OpsFunction[];
  libraries: ProjectLibrary[];
  active: `function:${string}` | `library:${string}`;
  dirty: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const confirmNavigation = () =>
    !dirty || window.confirm("Discard the unsaved changes in the current editor?");

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <div className="relative min-w-0">
        <Code2
          size={13}
          className="pointer-events-none absolute left-2.5 top-2.5 text-muted-foreground"
        />
        <select
          aria-label="Switch Function or library"
          title="Switch Function or library"
          className="field h-8 w-[190px] truncate py-0 pl-8 pr-7 text-xs sm:w-[240px]"
          value={active}
          onChange={(event) => {
            if (!confirmNavigation()) return;
            const [kind, id] = event.target.value.split(":", 2);
            router.push(kind === "library" ? `/libraries/${id}` : `/functions/${id}`);
          }}
        >
          {active === "function:new" && (
            <option value="function:new">New Function</option>
          )}
          <optgroup label="Functions">
            {functions.map((fn) => (
              <option key={fn.id} value={`function:${fn.id}`}>
                {fn.name} · v{fn.version}
              </option>
            ))}
          </optgroup>
          {active === "library:new" && <option value="library:new">New library</option>}
          <optgroup label="Libraries">
            {libraries.map((library) => (
              <option key={library.id} value={`library:${library.id}`}>
                {library.importPath} · v{library.version}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      {canManage && (
        <>
          <Link
            href="/functions/new"
            onClick={(event) => {
              if (!confirmNavigation()) event.preventDefault();
            }}
            aria-label="New Function"
            title="New Function"
            className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card hover:bg-muted"
          >
            <Plus size={13} />
            <span className="sr-only">New Function</span>
          </Link>
          <Link
            href="/libraries/new"
            onClick={(event) => {
              if (!confirmNavigation()) event.preventDefault();
            }}
            aria-label="New library"
            title="New library"
            className="hidden h-8 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-2 text-[11px] font-medium hover:bg-muted sm:flex"
          >
            <Library size={12} /> <Plus size={11} />
            <span className="sr-only">New library</span>
          </Link>
        </>
      )}
    </div>
  );
}
