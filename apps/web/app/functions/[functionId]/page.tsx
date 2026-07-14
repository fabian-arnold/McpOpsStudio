"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Beaker,
  Braces,
  Circle,
  Code2,
  FileInput,
  Library,
  Link2,
  Plus,
  Rocket,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { AppShell } from "@/components/shell";
import { TypeScriptEditor } from "@/components/typescript-editor";
import {
  BindingEditorDialog,
  type EditableFunctionBinding,
} from "@/components/binding-editor-dialog";
import { PermissionAutocomplete } from "@/components/permission-autocomplete";
import {
  generateExampleFromSchema,
  SchemaDefinitionEditor,
  SchemaDrivenInput,
} from "@/components/schema-input-tools";
import { Badge, Button, EmptyState, LoadError, Skeleton } from "@/components/ui";
import { useToast } from "@/components/providers";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type {
  FunctionDetail,
  FunctionHttpBinding,
  FunctionMcpBinding,
  OpsFunction,
  ProjectLibrary,
  RuntimeEndpoint,
} from "@/lib/types";

type Secret = { id: string; name: string; environmentId: string };
type Draft = {
  name: string;
  slug: string;
  description: string;
  code: string;
  inputSchema: string;
  outputSchema: string;
  timeoutMs: number;
  enabled: boolean;
  riskLevel: "read" | "write" | "destructive";
  permissions: string[];
  secretGrantIds: string[];
};

const blank: Draft = {
  name: "",
  slug: "",
  description: "",
  code: 'export default async function handler(ctx: RuntimeContext, input: FunctionInput) {\n  ctx.logger.info("Function invoked", { requestId: ctx.invocation.requestId });\n  return { ok: true };\n}\n',
  inputSchema:
    '{\n  "type": "object",\n  "properties": {},\n  "additionalProperties": false\n}',
  outputSchema:
    '{\n  "type": "object",\n  "properties": { "ok": { "type": "boolean" } },\n  "required": ["ok"]\n}',
  timeoutMs: 30000,
  enabled: true,
  riskLevel: "read",
  permissions: [],
  secretGrantIds: [],
};

type InspectorTab = "settings" | "schemas" | "bindings";
type TestConsoleTab = "setup" | "output" | "logs" | "error";
type TestInputMode = "form" | "json";
type StoredTestValues = {
  endpointId: string;
  input: string;
  inputMode: TestInputMode;
  permissions: string[];
  source: "test" | "mcp" | "http";
  subject: string;
};
type WorkbenchPanel = "left" | "right" | "bottom";
type WorkbenchLayout = { left: number; right: number; bottom: number };
const defaultWorkbenchLayout: WorkbenchLayout = { left: 250, right: 360, bottom: 250 };

function FunctionWorkbench() {
  const { functionId } = useParams<{ functionId?: string }>();
  const router = useRouter();
  const toast = useToast();
  const user = useCurrentUser();
  const canEdit = roleAllows(user?.role, ["owner", "admin", "developer"]);
  const canOperate = roleAllows(user?.role, [
    "owner",
    "admin",
    "developer",
    "operator",
  ]);
  const [fn, setFn] = useState<FunctionDetail>();
  const [functions, setFunctions] = useState<OpsFunction[]>([]);
  const [libraries, setLibraries] = useState<ProjectLibrary[]>([]);
  const [endpoints, setEndpoints] = useState<RuntimeEndpoint[]>([]);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "validate" | "test">();
  const [loadError, setLoadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [endpointId, setEndpointId] = useState("");
  const [testInput, setTestInput] = useState("{}");
  const [testInputMode, setTestInputMode] = useState<TestInputMode>("form");
  const [testPermissions, setTestPermissions] = useState<string[]>([]);
  const [testSubject, setTestSubject] = useState("editor-test");
  const [testSource, setTestSource] = useState<"test" | "mcp" | "http">("test");
  const [testResult, setTestResult] = useState<unknown>();
  const [testConsoleTab, setTestConsoleTab] = useState<TestConsoleTab>("setup");
  const [navigatorQuery, setNavigatorQuery] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("settings");
  const [bindingBusyId, setBindingBusyId] = useState<string>();
  const [deploying, setDeploying] = useState(false);
  const [testValuesHydratedFor, setTestValuesHydratedFor] = useState<string>();
  const [newFunctionSetupOpen, setNewFunctionSetupOpen] = useState(false);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [workbenchLayout, setWorkbenchLayout] = useState(defaultWorkbenchLayout);
  const [layoutHydrated, setLayoutHydrated] = useState(false);

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      const [allFunctions, allLibraries, allEndpoints, allSecrets] = await Promise.all([
        api<OpsFunction[]>("/api/functions"),
        api<ProjectLibrary[]>("/api/libraries"),
        api<RuntimeEndpoint[]>("/api/runtime-endpoints"),
        api<Secret[]>("/api/secrets"),
      ]);
      setFunctions(allFunctions);
      setLibraries(allLibraries);
      setEndpoints(allEndpoints);
      setSecrets(allSecrets);
      setEndpointId(
        (value) =>
          value ||
          allEndpoints.find(
            (endpoint) =>
              endpoint.environment.slug === "development" && endpoint.activeDeployment,
          )?.id ||
          "",
      );
      if (!functionId) {
        const storageKey = `mcpops:last-function:${user?.project.id ?? "project"}`;
        const remembered = window.localStorage.getItem(storageKey);
        const selected =
          allFunctions.find((item) => item.id === remembered)?.id ??
          allFunctions[0]?.id ??
          "new";
        setDraft(blank);
        router.replace(`/functions/${selected}`);
        return;
      }
      if (functionId === "new") {
        setFn(undefined);
        setDraft(blank);
        setDirty(false);
        setInspectorTab("settings");
        setSlugManuallyEdited(false);
        setNewFunctionSetupOpen(true);
        return;
      }
      const current = await api<FunctionDetail>(`/api/functions/${functionId}`);
      setFn(current);
      setNewFunctionSetupOpen(false);
      window.localStorage.setItem(
        `mcpops:last-function:${user?.project.id ?? "project"}`,
        current.id,
      );
      setDraft({
        name: current.name,
        slug: current.slug,
        description: current.description,
        code: current.code,
        inputSchema: JSON.stringify(current.inputSchema, null, 2),
        outputSchema: JSON.stringify(current.outputSchema, null, 2),
        timeoutMs: current.timeoutMs,
        enabled: current.enabled,
        riskLevel: current.riskLevel,
        permissions: current.requiredPermissions,
        secretGrantIds: current.secretGrants.flatMap((grant) =>
          grant.secretId ? [grant.secretId] : [],
        ),
      });
      const boundEndpointIds = new Set([
        ...(current.mcpBindings ?? []).map((binding) => binding.endpoint.id),
        ...(current.httpBindings ?? []).map((binding) => binding.endpoint.id),
      ]);
      const savedTestValues = readStoredTestValues(
        window.localStorage.getItem(
          `mcpops:function-test:${user?.project.id ?? "project"}:${current.id}`,
        ),
      );
      const availableEndpoint = (id: string | undefined) =>
        allEndpoints.find(
          (endpoint) =>
            endpoint.id === id &&
            endpoint.environment.slug === "development" &&
            endpoint.activeDeployment,
        );
      setDirty(false);
      setEndpointId(
        availableEndpoint(savedTestValues?.endpointId)?.id ??
          allEndpoints.find(
            (endpoint) =>
              endpoint.environment.slug === "development" &&
              endpoint.activeDeployment &&
              boundEndpointIds.has(endpoint.id),
          )?.id ??
          allEndpoints.find(
            (endpoint) =>
              endpoint.environment.slug === "development" && endpoint.activeDeployment,
          )?.id ??
          "",
      );
      setTestInput(savedTestValues?.input ?? "{}");
      setTestInputMode(savedTestValues?.inputMode ?? "form");
      setTestPermissions(savedTestValues?.permissions ?? []);
      setTestSource(savedTestValues?.source ?? "test");
      setTestSubject(savedTestValues?.subject ?? "editor-test");
      setTestValuesHydratedFor(current.id);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [functionId, router, user?.project.id]);
  useEffect(() => void load(), [attempt, load]);
  useEffect(() => {
    setWorkbenchLayout(
      readWorkbenchLayout(
        window.localStorage.getItem("mcpops:function-workbench-layout"),
      ),
    );
    setLayoutHydrated(true);
  }, []);
  useEffect(() => {
    if (layoutHydrated)
      window.localStorage.setItem(
        "mcpops:function-workbench-layout",
        JSON.stringify(workbenchLayout),
      );
  }, [layoutHydrated, workbenchLayout]);
  useEffect(() => {
    if (!fn || testValuesHydratedFor !== fn.id) return;
    const values: StoredTestValues = {
      endpointId,
      input: testInput,
      inputMode: testInputMode,
      permissions: testPermissions,
      source: testSource,
      subject: testSubject,
    };
    window.localStorage.setItem(
      `mcpops:function-test:${user?.project.id ?? "project"}:${fn.id}`,
      JSON.stringify(values),
    );
  }, [
    endpointId,
    fn,
    testInput,
    testInputMode,
    testPermissions,
    testSource,
    testSubject,
    testValuesHydratedFor,
    user?.project.id,
  ]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const schemas = useMemo(() => {
    try {
      return draft
        ? {
            input: JSON.parse(draft.inputSchema) as Record<string, unknown>,
            output: JSON.parse(draft.outputSchema) as Record<string, unknown>,
          }
        : undefined;
    } catch {
      return undefined;
    }
  }, [draft]);
  const update = (patch: Partial<Draft>) => {
    setDraft((value) => (value ? { ...value, ...patch } : value));
    setDirty(true);
  };
  const payload = () => {
    if (!draft || !schemas)
      throw new Error("Input and output schemas must be valid JSON.");
    return {
      name: draft.name,
      slug: draft.slug,
      description: draft.description,
      code: draft.code,
      inputSchema: schemas.input,
      outputSchema: schemas.output,
      timeoutMs: draft.timeoutMs,
      enabled: draft.enabled,
      riskLevel: draft.riskLevel,
      requiredPermissions: draft.permissions,
      secretGrantIds: draft.secretGrantIds,
      cachePolicy: null,
    };
  };

  async function save() {
    setBusy("save");
    try {
      const saved = await api<FunctionDetail>(
        fn ? `/api/functions/${fn.id}` : "/api/functions",
        {
          method: fn ? "PATCH" : "POST",
          body: JSON.stringify(payload()),
        },
      );
      setFn(saved);
      const storedTestValues: StoredTestValues = {
        endpointId,
        input: testInput,
        inputMode: testInputMode,
        permissions: testPermissions,
        source: testSource,
        subject: testSubject,
      };
      window.localStorage.setItem(
        `mcpops:function-test:${user?.project.id ?? "project"}:${saved.id}`,
        JSON.stringify(storedTestValues),
      );
      setTestValuesHydratedFor(saved.id);
      setDirty(false);
      toast({
        title: `Development Function v${saved.version} saved`,
        description:
          "You can test this saved version now. Public endpoints stay pinned until the Project is deployed.",
        tone: "success",
      });
      if (!fn) router.replace(`/functions/${saved.id}`);
      setFunctions((items) => {
        const next = items.filter((item) => item.id !== saved.id);
        return [...next, saved].sort((left, right) =>
          left.name.localeCompare(right.name),
        );
      });
    } catch (error) {
      toast({
        title: "Function was not saved",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setBusy(undefined);
    }
  }
  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (busy || !canEdit) return;
      if (
        !draft ||
        draft.name.trim().length < 2 ||
        !validFunctionSlug(draft.slug) ||
        !schemas
      ) {
        toast({
          title: "Function cannot be saved yet",
          description: "Add a valid name and slug, and fix invalid schema JSON.",
          tone: "error",
        });
        return;
      }
      document.querySelector<HTMLButtonElement>("[data-function-save]")?.click();
    };
    window.addEventListener("keydown", handleSaveShortcut, true);
    return () => window.removeEventListener("keydown", handleSaveShortcut, true);
  }, [busy, canEdit, draft, schemas, toast]);
  async function validate() {
    setBusy("validate");
    try {
      const result = await api<{
        valid: boolean;
        diagnostics?: { message: string }[];
      }>(`/api/functions/${fn?.id ?? "new"}/validate`, {
        method: "POST",
        body: JSON.stringify(payload()),
      });
      setTestResult(result);
      toast({
        title: result.valid ? "Validation passed" : "Validation failed",
        ...(result.diagnostics?.length
          ? {
              description: result.diagnostics.map((item) => item.message).join("; "),
            }
          : {}),
        tone: result.valid ? "success" : "error",
      });
    } catch (error) {
      toast({
        title: "Validation failed",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setBusy(undefined);
    }
  }
  async function test() {
    if (!fn) return;
    setBusy("test");
    try {
      const result = await api<Record<string, unknown>>(
        `/api/functions/${fn.id}/test`,
        {
          method: "POST",
          body: JSON.stringify({
            endpointId,
            input: JSON.parse(testInput),
            source: testSource,
            caller: {
              subject: testSubject || "editor-test",
              permissions: testPermissions,
              claims: {},
            },
          }),
        },
      );
      setTestResult(result);
      setTestConsoleTab(result.status === "success" ? "output" : "error");
    } catch (error) {
      setTestResult({ status: "error", error: { message: errorMessage(error) } });
      setTestConsoleTab("error");
    } finally {
      setBusy(undefined);
    }
  }

  const filteredFunctions = useMemo(() => {
    const needle = navigatorQuery.trim().toLowerCase();
    return needle
      ? functions.filter((item) =>
          `${item.name} ${item.slug} ${item.description}`
            .toLowerCase()
            .includes(needle),
        )
      : functions;
  }, [functions, navigatorQuery]);
  const logicalSecrets = useMemo(() => {
    const selected = new Set(draft?.secretGrantIds ?? []);
    const byName = new Map<string, Secret>();
    for (const secret of secrets) {
      const current = byName.get(secret.name);
      if (
        !current ||
        selected.has(secret.id) ||
        (!selected.has(current.id) &&
          endpoints.find((endpoint) => endpoint.environment.id === secret.environmentId)
            ?.environment.slug === "development")
      )
        byName.set(secret.name, secret);
    }
    return [...byName.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [draft?.secretGrantIds, endpoints, secrets]);
  const permissionSuggestions = useMemo(
    () =>
      [...new Set(functions.flatMap((item) => item.requiredPermissions))].sort(
        (left, right) => left.localeCompare(right),
      ),
    [functions],
  );
  const testRecord = asRecord(testResult);
  const testLogs = Array.isArray(testRecord.logs) ? testRecord.logs.map(asRecord) : [];
  const selectedSummary = functions.find((item) => item.id === fn?.id);

  function navigate(next: string) {
    if (
      dirty &&
      !window.confirm("Discard the unsaved changes in the current Function?")
    )
      return;
    router.push(next);
  }

  function resizePanel(panel: WorkbenchPanel, delta: number) {
    setWorkbenchLayout((current) => ({
      ...current,
      [panel]: clampPanelSize(panel, current[panel] + delta),
    }));
  }

  function startPanelResize(panel: WorkbenchPanel, event: React.PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = workbenchLayout[panel];
    document.body.style.userSelect = "none";
    document.body.style.cursor = panel === "bottom" ? "row-resize" : "col-resize";
    const move = (moveEvent: PointerEvent) => {
      const delta =
        panel === "left"
          ? moveEvent.clientX - startX
          : panel === "right"
            ? startX - moveEvent.clientX
            : startY - moveEvent.clientY;
      setWorkbenchLayout((current) => ({
        ...current,
        [panel]: clampPanelSize(panel, initial + delta),
      }));
    };
    const stop = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  async function refreshFunctionMetadata() {
    if (!fn) return;
    const [current, allFunctions] = await Promise.all([
      api<FunctionDetail>(`/api/functions/${fn.id}`),
      api<OpsFunction[]>("/api/functions"),
    ]);
    setFn(current);
    setFunctions(allFunctions);
  }

  async function toggleBinding(binding: EditableFunctionBinding) {
    setBindingBusyId(binding.id);
    try {
      await api(
        `/api/runtime-endpoints/${binding.endpointId}/${binding.kind === "mcp" ? "mcp-bindings" : "http-bindings"}/${binding.id}`,
        { method: "PATCH", body: JSON.stringify({ enabled: !binding.enabled }) },
      );
      await refreshFunctionMetadata();
    } catch (error) {
      toast({
        title: "Binding was not changed",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setBindingBusyId(undefined);
    }
  }

  async function removeBinding(binding: EditableFunctionBinding) {
    if (
      !window.confirm(
        "Remove this binding? Runtime traffic remains unchanged until the Project is deployed.",
      )
    )
      return;
    setBindingBusyId(binding.id);
    try {
      await api(
        `/api/runtime-endpoints/${binding.endpointId}/${binding.kind === "mcp" ? "mcp-bindings" : "http-bindings"}/${binding.id}`,
        { method: "DELETE" },
      );
      await refreshFunctionMetadata();
      toast({
        title: "Binding removed",
        description: "Deploy the Project to publish this change.",
        tone: "success",
      });
    } catch (error) {
      toast({
        title: "Binding was not removed",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setBindingBusyId(undefined);
    }
  }

  async function deploy() {
    setDeploying(true);
    try {
      await api("/api/deployments", { method: "POST", body: "{}" });
      toast({
        title: "Development deployment queued",
        description:
          "All saved Function and binding changes will be built as one immutable Project snapshot.",
        tone: "success",
      });
    } catch (error) {
      toast({
        title: "Deployment was not queued",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setDeploying(false);
    }
  }

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
          className="grid min-h-[calc(100vh-150px)] grid-cols-1 xl:h-[calc(100vh-150px)] xl:min-h-0 xl:grid-cols-[var(--workbench-left)_6px_minmax(520px,1fr)_6px_var(--workbench-right)]"
          style={
            {
              "--workbench-left": `${workbenchLayout.left}px`,
              "--workbench-right": `${workbenchLayout.right}px`,
            } as React.CSSProperties
          }
        >
          <nav className="border-r bg-card p-3 xl:overflow-auto">
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
            <section
              className="shrink-0 overflow-auto border-t bg-card"
              style={{ height: workbenchLayout.bottom }}
            >
              <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                <div className="mr-2 flex items-center gap-2 text-xs font-semibold">
                  <TerminalSquare size={13} /> Test console
                </div>
                {(["setup", "output", "logs", "error"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setTestConsoleTab(tab)}
                    className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium capitalize ${testConsoleTab === tab ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {tab}
                    {tab === "logs" && testLogs.length ? ` (${testLogs.length})` : ""}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  {typeof testRecord.status === "string" && (
                    <Badge
                      tone={testRecord.status === "success" ? "success" : "danger"}
                    >
                      {testRecord.status}
                    </Badge>
                  )}
                  {typeof testRecord.durationMs === "number" && (
                    <span className="text-[10px] text-muted-foreground">
                      {testRecord.durationMs} ms
                    </span>
                  )}
                  {dirty && (
                    <span className="text-[10px] text-amber-600">
                      Save before testing
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={test}
                    loading={busy === "test"}
                    disabled={!canOperate || !fn || !endpointId || dirty}
                  >
                    <Beaker size={12} /> Run
                  </Button>
                </div>
              </div>
              <div className="min-h-44 p-3">
                {testConsoleTab === "setup" ? (
                  <div className="grid gap-3 lg:grid-cols-[220px_180px_1fr]">
                    <div>
                      <label className="label">Capability endpoint</label>
                      <select
                        className="field"
                        value={endpointId}
                        onChange={(event) => setEndpointId(event.target.value)}
                      >
                        <option value="">Select endpoint</option>
                        {endpoints
                          .filter(
                            (endpoint) =>
                              endpoint.environment.slug === "development" &&
                              endpoint.activeDeployment,
                          )
                          .map((endpoint) => (
                            <option value={endpoint.id} key={endpoint.id}>
                              {endpoint.name} · v{endpoint.activeDeployment?.version}
                            </option>
                          ))}
                      </select>
                      <label className="label mt-2">Simulated source</label>
                      <select
                        className="field"
                        value={testSource}
                        onChange={(event) =>
                          setTestSource(event.target.value as typeof testSource)
                        }
                      >
                        <option value="test">Test</option>
                        <option value="mcp">MCP</option>
                        <option value="http">HTTP</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Caller subject</label>
                      <input
                        className="field font-mono"
                        value={testSubject}
                        onChange={(event) => setTestSubject(event.target.value)}
                      />
                      <label className="label mt-2">Caller permissions</label>
                      <PermissionAutocomplete
                        value={testPermissions}
                        suggestions={[
                          ...new Set([
                            ...permissionSuggestions,
                            ...(draft?.permissions ?? []),
                          ]),
                        ]}
                        onChange={setTestPermissions}
                        allowWildcard
                        placeholder="Search project permissions"
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-1">
                        <label className="label mb-0 mr-auto">Function input</label>
                        <button
                          type="button"
                          className={`rounded px-2 py-1 text-[10px] ${testInputMode === "form" ? "bg-muted" : "text-muted-foreground"}`}
                          onClick={() => setTestInputMode("form")}
                        >
                          Form
                        </button>
                        <button
                          type="button"
                          className={`rounded px-2 py-1 text-[10px] ${testInputMode === "json" ? "bg-muted" : "text-muted-foreground"}`}
                          onClick={() => setTestInputMode("json")}
                        >
                          JSON
                        </button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            schemas &&
                            setTestInput(
                              JSON.stringify(
                                generateExampleFromSchema(schemas.input),
                                null,
                                2,
                              ),
                            )
                          }
                        >
                          <WandSparkles size={11} /> Generate
                        </Button>
                      </div>
                      {testInputMode === "form" && schemas ? (
                        <SchemaDrivenInput
                          schema={schemas.input}
                          value={testInput}
                          onChange={setTestInput}
                        />
                      ) : (
                        <textarea
                          className="field min-h-32 font-mono text-[11px]"
                          value={testInput}
                          onChange={(event) => setTestInput(event.target.value)}
                        />
                      )}
                    </div>
                  </div>
                ) : testConsoleTab === "output" ? (
                  <ConsolePayload
                    empty="Run the Function to inspect its structured output."
                    value={testRecord.output}
                    metadata={testRecord}
                  />
                ) : testConsoleTab === "logs" ? (
                  <div className="max-h-64 space-y-1 overflow-auto font-mono text-[10px]">
                    {testLogs.length ? (
                      testLogs.map((log, index) => (
                        <div
                          key={`${String(log.timestamp)}-${index}`}
                          className="grid grid-cols-[70px_70px_1fr] gap-2 rounded-md border px-2 py-1.5"
                        >
                          <span className="text-muted-foreground">
                            {typeof log.timestamp === "string"
                              ? new Date(log.timestamp).toLocaleTimeString()
                              : ""}
                          </span>
                          <span className="uppercase">
                            {String(log.level ?? "info")}
                          </span>
                          <span className="whitespace-pre-wrap">
                            {String(log.message ?? "")}
                            {log.metadata ? ` ${JSON.stringify(log.metadata)}` : ""}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No runtime logs were emitted.
                      </p>
                    )}
                  </div>
                ) : (
                  <ConsolePayload
                    empty="No error was returned by the latest test."
                    value={testRecord.error}
                    metadata={testRecord}
                  />
                )}
              </div>
            </section>
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
          <aside className="border-l bg-card xl:overflow-hidden">
            <div className="flex border-b p-1">
              {(
                [
                  { id: "settings", label: "Settings", icon: Settings2 },
                  { id: "schemas", label: "Schemas", icon: Braces },
                  { id: "bindings", label: "Bindings", icon: Link2 },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setInspectorTab(item.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[11px] font-medium ${inspectorTab === item.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <item.icon size={12} /> {item.label}
                </button>
              ))}
            </div>
            <div className="max-h-[calc(100vh-205px)] overflow-auto p-4">
              {!draft ? (
                <Skeleton className="h-96" />
              ) : inspectorTab === "settings" ? (
                <>
                  <Field label="Name">
                    <input
                      className="field"
                      value={draft.name}
                      onChange={(event) => {
                        const name = event.target.value;
                        update({
                          name,
                          ...(!fn && !slugManuallyEdited
                            ? { slug: functionSlug(name) }
                            : {}),
                        });
                      }}
                    />
                  </Field>
                  <Field
                    label="Slug"
                    hint={fn ? "Stable code identifier" : "Generated from the name"}
                  >
                    <input
                      className="field font-mono"
                      value={draft.slug}
                      onChange={(event) => {
                        setSlugManuallyEdited(true);
                        update({ slug: functionSlug(event.target.value) });
                      }}
                      readOnly={Boolean(fn)}
                    />
                  </Field>
                  <Field label="Description">
                    <textarea
                      className="field min-h-20"
                      value={draft.description}
                      onChange={(event) => update({ description: event.target.value })}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Risk">
                      <select
                        className="field"
                        value={draft.riskLevel}
                        onChange={(event) =>
                          update({
                            riskLevel: event.target.value as Draft["riskLevel"],
                          })
                        }
                      >
                        <option>read</option>
                        <option>write</option>
                        <option>destructive</option>
                      </select>
                    </Field>
                    <Field label="Timeout ms">
                      <input
                        className="field"
                        type="number"
                        value={draft.timeoutMs}
                        onChange={(event) =>
                          update({ timeoutMs: Number(event.target.value) })
                        }
                      />
                    </Field>
                  </div>
                  <Field
                    label="Required permissions"
                    hint="Choose a known permission or enter a new project permission"
                  >
                    <PermissionAutocomplete
                      value={draft.permissions}
                      suggestions={permissionSuggestions}
                      onChange={(permissions) => update({ permissions })}
                    />
                  </Field>
                  <label className="mb-4 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) => update({ enabled: event.target.checked })}
                    />{" "}
                    Enabled
                  </label>
                  <h3 className="mb-2 text-[11px] font-semibold">Secret grants</h3>
                  <p className="mb-2 text-[10px] text-muted-foreground">
                    One grant per project Secret name; runtime values still resolve from
                    the selected endpoint environment.
                  </p>
                  <div className="max-h-40 space-y-1 overflow-auto">
                    {logicalSecrets.map((secret) => {
                      const granted =
                        draft.secretGrantIds.includes(secret.id) ||
                        draft.secretGrantIds.some(
                          (id) =>
                            secrets.find((candidate) => candidate.id === id)?.name ===
                            secret.name,
                        );
                      return (
                        <label
                          key={secret.name}
                          className="flex items-center gap-2 text-[11px]"
                        >
                          <input
                            type="checkbox"
                            checked={granted}
                            onChange={(event) =>
                              update({
                                secretGrantIds: event.target.checked
                                  ? [
                                      ...draft.secretGrantIds.filter(
                                        (id) =>
                                          secrets.find(
                                            (candidate) => candidate.id === id,
                                          )?.name !== secret.name,
                                      ),
                                      secret.id,
                                    ]
                                  : draft.secretGrantIds.filter(
                                      (id) =>
                                        secrets.find((candidate) => candidate.id === id)
                                          ?.name !== secret.name,
                                    ),
                              })
                            }
                          />
                          <code>{secret.name}</code>
                        </label>
                      );
                    })}
                  </div>
                </>
              ) : inspectorTab === "schemas" ? (
                <>
                  <SchemaDefinitionEditor
                    label="Input schema"
                    value={draft.inputSchema}
                    onChange={(inputSchema) => update({ inputSchema })}
                  />
                  <SchemaDefinitionEditor
                    label="Output schema"
                    value={draft.outputSchema}
                    onChange={(outputSchema) => update({ outputSchema })}
                  />
                  {!schemas && (
                    <p className="text-xs text-red-500">Schema JSON is invalid.</p>
                  )}
                </>
              ) : (
                <FunctionBindings
                  fn={fn}
                  endpoints={endpoints}
                  functions={functions}
                  canEdit={canEdit}
                  busyId={bindingBusyId}
                  onChanged={refreshFunctionMetadata}
                  onToggle={toggleBinding}
                  onRemove={removeBinding}
                />
              )}
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

export default FunctionWorkbench;

function FunctionBindings({
  fn,
  endpoints,
  functions,
  canEdit,
  busyId,
  onChanged,
  onToggle,
  onRemove,
}: {
  fn?: FunctionDetail | undefined;
  endpoints: RuntimeEndpoint[];
  functions: OpsFunction[];
  canEdit: boolean;
  busyId?: string | undefined;
  onChanged: () => Promise<void>;
  onToggle: (binding: EditableFunctionBinding) => Promise<void>;
  onRemove: (binding: EditableFunctionBinding) => Promise<void>;
}) {
  if (!fn)
    return (
      <EmptyState
        icon={<Link2 />}
        title="Save the Function first"
        description="Bindings can be added after the initial development version exists."
      />
    );
  const mcp = fn.mcpBindings ?? [];
  const http = fn.httpBindings ?? [];
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold">Function bindings</h2>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Saved separately from Function versions. Deploy the Project to publish
            changes.
          </p>
        </div>
        {canEdit && (
          <BindingEditorDialog
            endpoints={endpoints}
            functions={functions}
            fixedFunctionId={fn.id}
            onSaved={onChanged}
          />
        )}
      </div>
      {!mcp.length && !http.length ? (
        <EmptyState
          icon={<Link2 />}
          title="Not exposed"
          description="Add an MCP tool or HTTP route binding for this Function."
        />
      ) : (
        <>
          <BindingGroup
            label="MCP tools"
            bindings={mcp.map(editableMcp)}
            endpoints={endpoints}
            functions={functions}
            fixedFunctionId={fn.id}
            canEdit={canEdit}
            busyId={busyId}
            onChanged={onChanged}
            onToggle={onToggle}
            onRemove={onRemove}
          />
          <BindingGroup
            label="HTTP routes"
            bindings={http.map(editableHttp)}
            endpoints={endpoints}
            functions={functions}
            fixedFunctionId={fn.id}
            canEdit={canEdit}
            busyId={busyId}
            onChanged={onChanged}
            onToggle={onToggle}
            onRemove={onRemove}
          />
        </>
      )}
    </div>
  );
}

function BindingGroup({
  label,
  bindings,
  endpoints,
  functions,
  fixedFunctionId,
  canEdit,
  busyId,
  onChanged,
  onToggle,
  onRemove,
}: {
  label: string;
  bindings: EditableFunctionBinding[];
  endpoints: RuntimeEndpoint[];
  functions: OpsFunction[];
  fixedFunctionId: string;
  canEdit: boolean;
  busyId?: string | undefined;
  onChanged: () => Promise<void>;
  onToggle: (binding: EditableFunctionBinding) => Promise<void>;
  onRemove: (binding: EditableFunctionBinding) => Promise<void>;
}) {
  if (!bindings.length) return null;
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h3>
      <div className="space-y-2">
        {bindings.map((binding) => {
          const exposure =
            binding.kind === "mcp"
              ? binding.toolName
              : `${binding.method} ${binding.path}`;
          const endpoint = endpoints.find((item) => item.id === binding.endpointId);
          return (
            <div key={binding.id} className="rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <code className="block truncate text-[11px] font-semibold">
                    {exposure}
                  </code>
                  {endpoint ? (
                    <Link
                      href={`${endpoint.kind === "mcp" ? "/mcp-endpoints" : "/http-apis"}/${endpoint.id}?tab=bindings`}
                      className="mt-1 block truncate text-[10px] text-muted-foreground hover:text-primary"
                    >
                      {endpoint.name} · {endpoint.environment.name}
                    </Link>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">
                      Endpoint unavailable
                    </span>
                  )}
                </div>
                <Badge tone={binding.enabled ? "success" : "neutral"}>
                  {binding.enabled ? "enabled" : "disabled"}
                </Badge>
              </div>
              {canEdit && (
                <div className="mt-2 flex justify-end gap-1 border-t pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busyId === binding.id}
                    disabled={Boolean(busyId)}
                    onClick={() => void onToggle(binding)}
                  >
                    {binding.enabled ? "Disable" : "Enable"}
                  </Button>
                  <BindingEditorDialog
                    endpoints={endpoints}
                    functions={functions}
                    fixedFunctionId={fixedFunctionId}
                    binding={binding}
                    onSaved={onChanged}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-red-500"
                    loading={busyId === binding.id}
                    disabled={Boolean(busyId)}
                    onClick={() => void onRemove(binding)}
                    aria-label="Remove binding"
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function editableMcp(binding: FunctionMcpBinding): EditableFunctionBinding {
  return {
    kind: "mcp",
    id: binding.id,
    endpointId: binding.endpoint.id,
    functionId: binding.functionId,
    toolName: binding.toolName,
    title: binding.title,
    description: binding.description,
    enabled: binding.enabled,
  };
}

function editableHttp(binding: FunctionHttpBinding): EditableFunctionBinding {
  return {
    kind: "http",
    id: binding.id,
    endpointId: binding.endpoint.id,
    functionId: binding.functionId,
    method: binding.method,
    path: binding.path,
    inputMapping: binding.inputMapping ?? null,
    responseMapping: binding.responseMapping ?? null,
    enabled: binding.enabled,
  };
}

function ResizeHandle({
  panel,
  value,
  onPointerDown,
  onResize,
  onReset,
}: {
  panel: WorkbenchPanel;
  value: number;
  onPointerDown: (panel: WorkbenchPanel, event: React.PointerEvent) => void;
  onResize: (panel: WorkbenchPanel, delta: number) => void;
  onReset: () => void;
}) {
  const horizontal = panel === "bottom";
  const keyboardDelta = (key: string) => {
    if (panel === "left")
      return key === "ArrowLeft" ? -16 : key === "ArrowRight" ? 16 : 0;
    if (panel === "right")
      return key === "ArrowLeft" ? 16 : key === "ArrowRight" ? -16 : 0;
    return key === "ArrowUp" ? 16 : key === "ArrowDown" ? -16 : 0;
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={`Resize ${panel} panel`}
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-valuenow={value}
      aria-valuemin={panel === "left" ? 190 : panel === "right" ? 300 : 180}
      aria-valuemax={panel === "left" ? 420 : panel === "right" ? 560 : 520}
      title="Drag to resize · Double-click to reset"
      className={
        horizontal
          ? "group flex h-1.5 cursor-row-resize items-center justify-center bg-border/50 outline-none hover:bg-primary/30 focus:bg-primary/30"
          : "group hidden cursor-col-resize items-center justify-center bg-border/50 outline-none hover:bg-primary/30 focus:bg-primary/30 xl:flex"
      }
      onPointerDown={(event) => onPointerDown(panel, event)}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const delta = keyboardDelta(event.key);
        if (!delta) return;
        event.preventDefault();
        onResize(panel, delta);
      }}
    >
      <span
        className={
          horizontal
            ? "h-0.5 w-10 rounded-full bg-muted-foreground/40 group-hover:bg-primary"
            : "h-10 w-0.5 rounded-full bg-muted-foreground/40 group-hover:bg-primary"
        }
      />
    </div>
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
        <span className="mt-1 block text-[10px] text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

function ConsolePayload({
  empty,
  value,
  metadata,
}: {
  empty: string;
  value: unknown;
  metadata: Record<string, unknown>;
}) {
  const details = [
    ["Request", metadata.requestId],
    ["Execution", metadata.executionId],
    ["Function version", metadata.functionVersion],
    ["Invocation source", metadata.invocationSource],
    ["Simulated source", metadata.simulatedSource],
  ].filter(
    (entry): entry is [string, string | number] =>
      typeof entry[1] === "string" || typeof entry[1] === "number",
  );
  const deployment = asRecord(metadata.activeDeployment);
  if (typeof deployment.version === "number")
    details.push(["Active deployment", deployment.version]);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-w-0 rounded-lg border bg-muted/20 p-3">
        {value === undefined || value === null ? (
          <p className="text-xs text-muted-foreground">{empty}</p>
        ) : (
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </div>
      <dl className="space-y-2 rounded-lg border p-3 text-[10px]">
        <dt className="font-semibold uppercase tracking-wider text-muted-foreground">
          Invocation metadata
        </dt>
        {details.length ? (
          details.map(([label, detail]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="truncate font-mono" title={String(detail)}>
                {detail}
              </dd>
            </div>
          ))
        ) : (
          <dd className="text-muted-foreground">
            Run the Function to populate metadata.
          </dd>
        )}
      </dl>
    </div>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readStoredTestValues(value: string | null): StoredTestValues | undefined {
  if (!value) return undefined;
  try {
    const parsed = asRecord(JSON.parse(value));
    const source = parsed.source;
    const inputMode = parsed.inputMode;
    if (
      typeof parsed.endpointId !== "string" ||
      typeof parsed.input !== "string" ||
      typeof parsed.subject !== "string" ||
      !Array.isArray(parsed.permissions) ||
      !parsed.permissions.every((permission) => typeof permission === "string") ||
      (source !== "test" && source !== "mcp" && source !== "http") ||
      (inputMode !== "form" && inputMode !== "json")
    )
      return undefined;
    return {
      endpointId: parsed.endpointId,
      input: parsed.input,
      inputMode,
      permissions: parsed.permissions as string[],
      source,
      subject: parsed.subject,
    };
  } catch {
    return undefined;
  }
}

function readWorkbenchLayout(value: string | null): WorkbenchLayout {
  if (!value) return defaultWorkbenchLayout;
  try {
    const parsed = asRecord(JSON.parse(value));
    return {
      left: clampPanelSize(
        "left",
        typeof parsed.left === "number" ? parsed.left : defaultWorkbenchLayout.left,
      ),
      right: clampPanelSize(
        "right",
        typeof parsed.right === "number" ? parsed.right : defaultWorkbenchLayout.right,
      ),
      bottom: clampPanelSize(
        "bottom",
        typeof parsed.bottom === "number"
          ? parsed.bottom
          : defaultWorkbenchLayout.bottom,
      ),
    };
  } catch {
    return defaultWorkbenchLayout;
  }
}

function clampPanelSize(panel: WorkbenchPanel, value: number) {
  const [minimum, maximum] =
    panel === "left" ? [190, 420] : panel === "right" ? [300, 560] : [180, 520];
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function functionSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function validFunctionSlug(value: string) {
  return (
    /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(value) &&
    value.length >= 2 &&
    value.length <= 80
  );
}
