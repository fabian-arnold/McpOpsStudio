"use client";
import {
  Beaker,
  Circle,
  Code2,
  FileInput,
  Library,
  Plus,
  Rocket,
  Save,
  Search,
  ShieldCheck,
} from "lucide-react";
import { AppShell } from "@/components/shell";
import { TypeScriptEditor } from "@/components/typescript-editor";
import { Badge, Button, LoadError, Skeleton } from "@/components/ui";
import {
  ResizeHandle,
  functionSlug,
  validFunctionSlug,
} from "@/features/functions/function-workbench-components";
import { defaultWorkbenchLayout } from "@/features/functions/function-workbench-types";

import { FunctionInspector } from "./function-inspector";
import { FunctionTestConsole } from "./function-test-console";
import type { FunctionWorkbenchModel } from "./use-function-workbench";

export function FunctionWorkbenchView({ model }: { model: FunctionWorkbenchModel }) {
  const {
    functionId,
    setAttempt,
    loadError,
    functions,
    libraries,
    fn,
    draft,
    dirty,
    busy,
    navigatorQuery,
    setNavigatorQuery,
    endpointId,
    deploying,
    newFunctionSetupOpen,
    setNewFunctionSetupOpen,
    slugManuallyEdited,
    setSlugManuallyEdited,
    setInspectorTab,
    workbenchLayout,
    setWorkbenchLayout,
    canEdit,
    canOperate,
    schemas,
    update,
    filteredFunctions,
    selectedSummary,
    navigate,
    resizePanel,
    startPanelResize,
    save,
    validate,
    test,
    deploy,
  } = model;
  return (
    <AppShell>
      <div className="-m-4 sm:-m-6 lg:-m-8">
        <header className="flex min-h-14 flex-wrap items-center gap-2 border-b bg-card px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Code2 size={15} />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Function workbench
              </p>
              <p className="truncate text-xs font-semibold">
                {draft?.name || "New Function"}
              </p>
            </div>
          </div>
          {fn && <Badge>v{fn.version}</Badge>}
          {dirty && (
            <Badge tone="warning">
              <Circle size={7} fill="currentColor" /> Unsaved
            </Badge>
          )}
          {selectedSummary?.usages?.some((usage) => usage.stale) && (
            <Badge tone="warning">Deploy needed</Badge>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={validate}
              loading={busy === "validate"}
              disabled={!draft}
            >
              <ShieldCheck size={13} /> Validate
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={test}
              loading={busy === "test"}
              disabled={!canOperate || !fn || !endpointId || dirty}
            >
              <Beaker size={13} /> Test
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={deploy}
              loading={deploying}
              disabled={!canOperate || !fn || dirty}
            >
              <Rocket size={13} /> Deploy Project
            </Button>
            <Button
              size="sm"
              onClick={save}
              loading={busy === "save"}
              disabled={
                !draft ||
                !canEdit ||
                draft.name.trim().length < 2 ||
                !validFunctionSlug(draft.slug) ||
                !schemas
              }
              title="Save (Ctrl+S)"
              data-function-save
            >
              <Save size={13} /> Save
            </Button>
          </div>
        </header>
        <div
          className="grid min-h-[calc(100vh-150px)] grid-cols-1 xl:h-[calc(100vh-150px)] xl:min-h-0 xl:grid-cols-[var(--workbench-left)_6px_minmax(340px,1fr)_6px_var(--workbench-right)]"
          style={
            {
              "--workbench-left": `${workbenchLayout.left}px`,
              "--workbench-right": `${workbenchLayout.right}px`,
            } as React.CSSProperties
          }
        >
          <nav className="border-b bg-card p-3 xl:overflow-auto xl:border-b-0 xl:border-r">
            <div className="mb-3 flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  size={13}
                  className="absolute left-2.5 top-2.5 text-muted-foreground"
                />
                <input
                  className="field h-8 pl-8 text-xs"
                  value={navigatorQuery}
                  onChange={(event) => setNavigatorQuery(event.target.value)}
                  placeholder="Search Functions…"
                />
              </div>
              {canEdit && (
                <Button
                  size="icon"
                  variant="secondary"
                  className="size-8"
                  onClick={() => {
                    setInspectorTab("settings");
                    setSlugManuallyEdited(false);
                    setNewFunctionSetupOpen(true);
                    navigate("/functions/new");
                  }}
                  aria-label="New Function"
                >
                  <Plus size={13} />
                </Button>
              )}
            </div>
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Functions
            </p>
            <div className="max-h-[48vh] space-y-0.5 overflow-auto">
              {filteredFunctions.map((item) => (
                <button
                  key={item.id}
                  onClick={() => navigate(`/functions/${item.id}`)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ${fn?.id === item.id ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                >
                  <Code2 size={13} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    v{item.version}
                  </span>
                </button>
              ))}
              {!filteredFunctions.length && (
                <p className="px-2 py-4 text-xs text-muted-foreground">
                  No matching Functions.
                </p>
              )}
            </div>
            <div className="my-3 border-t" />
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Project libraries
            </p>
            <div className="space-y-0.5">
              {libraries.map((library) => (
                <button
                  key={library.id}
                  onClick={() => navigate(`/libraries/${library.id}`)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-muted"
                >
                  <Library size={13} />
                  <span className="truncate">{library.importPath}</span>
                </button>
              ))}
            </div>
          </nav>
          <ResizeHandle
            panel="left"
            value={workbenchLayout.left}
            onPointerDown={startPanelResize}
            onResize={resizePanel}
            onReset={() =>
              setWorkbenchLayout((current) => ({
                ...current,
                left: defaultWorkbenchLayout.left,
              }))
            }
          />
          <main className="flex min-w-0 flex-col xl:h-full xl:min-h-0 xl:overflow-hidden">
            <div className="flex h-10 items-center gap-2 border-b bg-card px-3 text-[11px]">
              <FileInput size={12} /> {draft?.slug || "function"}.ts
            </div>
            {functionId === "new" && draft && newFunctionSetupOpen && (
              <section className="border-b bg-primary/5 p-4">
                <div className="mx-auto max-w-3xl">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                    New Function · required setup
                  </p>
                  <div className="mt-1 flex flex-wrap items-end gap-3">
                    <label className="min-w-52 flex-1">
                      <span className="label">Function name</span>
                      <input
                        className="field"
                        value={draft.name}
                        placeholder="Search customers"
                        onChange={(event) => {
                          const name = event.target.value;
                          update({
                            name,
                            ...(!slugManuallyEdited
                              ? { slug: functionSlug(name) }
                              : {}),
                          });
                        }}
                      />
                    </label>
                    <label className="min-w-52 flex-1">
                      <span className="label">Slug</span>
                      <input
                        className="field font-mono"
                        value={draft.slug}
                        placeholder="search_customers"
                        onChange={(event) => {
                          setSlugManuallyEdited(true);
                          update({ slug: functionSlug(event.target.value) });
                        }}
                      />
                    </label>
                    <Button
                      disabled={
                        draft.name.trim().length < 2 || !validFunctionSlug(draft.slug)
                      }
                      onClick={() => setNewFunctionSetupOpen(false)}
                    >
                      Continue to editor
                    </Button>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    The slug is generated from the name and becomes the stable
                    identifier used by <code>ctx.functions.call()</code>.
                  </p>
                </div>
              </section>
            )}
            <div className="min-h-80 flex-1 xl:min-h-0">
              {loadError ? (
                <div className="p-5">
                  <LoadError
                    title="Unable to open the Function editor"
                    message={loadError}
                    onRetry={() => setAttempt((value) => value + 1)}
                  />
                </div>
              ) : !draft ? (
                <Skeleton className="h-full min-h-[560px] rounded-none" />
              ) : (
                <TypeScriptEditor
                  path={`file:///functions/${draft.slug || "new"}.ts`}
                  value={draft.code}
                  onChange={(code) => update({ code })}
                  libraries={libraries}
                  functions={functions}
                  {...(schemas ? { inputSchema: schemas.input } : {})}
                  runtimeContext
                  readOnly={!canEdit}
                />
              )}
            </div>
            <ResizeHandle
              panel="bottom"
              value={workbenchLayout.bottom}
              onPointerDown={startPanelResize}
              onResize={resizePanel}
              onReset={() =>
                setWorkbenchLayout((current) => ({
                  ...current,
                  bottom: defaultWorkbenchLayout.bottom,
                }))
              }
            />
            <FunctionTestConsole model={model} />
          </main>
          <ResizeHandle
            panel="right"
            value={workbenchLayout.right}
            onPointerDown={startPanelResize}
            onResize={resizePanel}
            onReset={() =>
              setWorkbenchLayout((current) => ({
                ...current,
                right: defaultWorkbenchLayout.right,
              }))
            }
          />
          <FunctionInspector model={model} />
        </div>
      </div>
    </AppShell>
  );
}
