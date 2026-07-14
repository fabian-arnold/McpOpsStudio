"use client";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/providers";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type {
  FunctionDetail,
  OpsFunction,
  ProjectLibrary,
  RuntimeEndpoint,
} from "@/lib/types";
import {
  asRecord,
  readStoredTestValues,
  validFunctionSlug,
} from "@/features/functions/function-workbench-components";
import {
  blank,
  type Draft,
  type InspectorTab,
  type Secret,
  type StoredTestValues,
  type TestConsoleTab,
  type TestInputMode,
} from "@/features/functions/function-workbench-types";

import { useFunctionBindingActions } from "./use-function-binding-actions";
import { useWorkbenchLayout } from "./use-workbench-layout";

export function useFunctionWorkbenchModel() {
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
  const [testValuesHydratedFor, setTestValuesHydratedFor] = useState<string>();
  const [newFunctionSetupOpen, setNewFunctionSetupOpen] = useState(false);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const { workbenchLayout, setWorkbenchLayout, resizePanel, startPanelResize } =
    useWorkbenchLayout();

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

  const {
    bindingBusyId,
    deploying,
    refreshFunctionMetadata,
    toggleBinding,
    removeBinding,
    deploy,
  } = useFunctionBindingActions({ fn, setFn, setFunctions, toast });

  return {
    functionId,
    attempt,
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
    secrets,
    endpoints,
    endpointId,
    setEndpointId,
    testInput,
    setTestInput,
    testSubject,
    setTestSubject,
    testPermissions,
    setTestPermissions,
    testSource,
    setTestSource,
    testInputMode,
    setTestInputMode,
    deploying,
    newFunctionSetupOpen,
    setNewFunctionSetupOpen,
    slugManuallyEdited,
    setSlugManuallyEdited,
    testResult,
    testConsoleTab,
    setTestConsoleTab,
    inspectorTab,
    setInspectorTab,
    bindingBusyId,
    workbenchLayout,
    setWorkbenchLayout,
    canEdit,
    canOperate,
    schemas,
    update,
    filteredFunctions,
    logicalSecrets,
    permissionSuggestions,
    testRecord,
    testLogs,
    selectedSummary,
    navigate,
    resizePanel,
    startPanelResize,
    save,
    validate,
    test,
    refreshFunctionMetadata,
    toggleBinding,
    removeBinding,
    deploy,
  };
}

export type FunctionWorkbenchModel = ReturnType<typeof useFunctionWorkbenchModel>;
