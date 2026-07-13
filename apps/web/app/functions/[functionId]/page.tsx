"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Beaker, Circle, Save, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/shell";
import { EditorSwitcher } from "@/components/editor-switcher";
import { TypeScriptEditor } from "@/components/typescript-editor";
import {
  Badge,
  Button,
  LoadError,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/providers";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type { OpsFunction, ProjectLibrary, RuntimeEndpoint } from "@/lib/types";

type Secret = { id: string; name: string; environmentId: string };
type Draft = {
  name: string;
  slug: string;
  title: string;
  description: string;
  code: string;
  inputSchema: string;
  outputSchema: string;
  timeoutMs: number;
  enabled: boolean;
  riskLevel: "read" | "write" | "destructive";
  permissions: string;
  secretGrantIds: string[];
};

const blank: Draft = {
  name: "",
  slug: "",
  title: "",
  description: "",
  code: 'export default async function handler(ctx: RuntimeContext, input: FunctionInput) {\n  ctx.logger.info("Function invoked", { requestId: ctx.invocation.requestId });\n  return { ok: true };\n}\n',
  inputSchema:
    '{\n  "type": "object",\n  "properties": {},\n  "additionalProperties": false\n}',
  outputSchema:
    '{\n  "type": "object",\n  "properties": { "ok": { "type": "boolean" } },\n  "required": ["ok"]\n}',
  timeoutMs: 30000,
  enabled: true,
  riskLevel: "read",
  permissions: "",
  secretGrantIds: [],
};

export default function FunctionEditorPage() {
  const { functionId } = useParams<{ functionId: string }>();
  const router = useRouter();
  const toast = useToast();
  const user = useCurrentUser();
  const canEdit = roleAllows(user?.role, ["owner", "admin", "developer"]);
  const [fn, setFn] = useState<OpsFunction>();
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
  const [testPermissions, setTestPermissions] = useState("");
  const [testResult, setTestResult] = useState<unknown>();

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      const [allFunctions, allLibraries, allEndpoints, allSecrets] =
        await Promise.all([
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
              endpoint.environment.slug === "development" &&
              endpoint.activeDeployment,
          )?.id ||
          "",
      );
      if (functionId === "new") {
        setFn(undefined);
        setDraft(blank);
        return;
      }
      const current = await api<OpsFunction>(`/api/functions/${functionId}`);
      setFn(current);
      setEndpointId((value) =>
        value && allEndpoints.some((endpoint) => endpoint.id === value)
          ? value
          : (allEndpoints.find(
              (endpoint) =>
                endpoint.environment.slug === "development" &&
                endpoint.activeDeployment,
            )?.id ?? ""),
      );
      setDraft({
        name: current.name,
        slug: current.slug,
        title: current.title,
        description: current.description,
        code: current.code,
        inputSchema: JSON.stringify(current.inputSchema, null, 2),
        outputSchema: JSON.stringify(current.outputSchema, null, 2),
        timeoutMs: current.timeoutMs,
        enabled: current.enabled,
        riskLevel: current.riskLevel,
        permissions: current.requiredPermissions.join(", "),
        secretGrantIds: current.secretGrants.flatMap((grant) =>
          grant.secretId ? [grant.secretId] : [],
        ),
      });
      setDirty(false);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [functionId]);
  useEffect(() => void load(), [attempt, load]);
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
      title: draft.title,
      description: draft.description,
      code: draft.code,
      inputSchema: schemas.input,
      outputSchema: schemas.output,
      timeoutMs: draft.timeoutMs,
      enabled: draft.enabled,
      riskLevel: draft.riskLevel,
      requiredPermissions: list(draft.permissions),
      secretGrantIds: draft.secretGrantIds,
      cachePolicy: null,
    };
  };

  async function save() {
    setBusy("save");
    try {
      const saved = await api<OpsFunction>(
        fn ? `/api/functions/${fn.id}` : "/api/functions",
        {
          method: fn ? "PATCH" : "POST",
          body: JSON.stringify(payload()),
        },
      );
      setFn(saved);
      setDirty(false);
      toast({
        title: `Development Function v${saved.version} saved`,
        description:
          "You can test this saved version now. Public endpoints stay pinned until the Project is deployed.",
        tone: "success",
      });
      if (!fn) router.replace(`/functions/${saved.id}`);
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
              description: result.diagnostics
                .map((item) => item.message)
                .join("; "),
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
      setTestResult(
        await api(`/api/functions/${fn.id}/test`, {
          method: "POST",
          body: JSON.stringify({
            endpointId,
            input: JSON.parse(testInput),
            source: "test",
            caller: {
              subject: "editor-test",
              permissions: list(testPermissions),
              claims: {},
            },
          }),
        }),
      );
    } catch (error) {
      setTestResult({ error: errorMessage(error) });
    } finally {
      setBusy(undefined);
    }
  }

  if (loadError)
    return (
      <AppShell>
        <LoadError
          title="Unable to open the Function editor"
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
        <header className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2.5">
          <Link
            href="/functions"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={13} /> Functions
          </Link>
          <span className="hidden text-muted-foreground sm:inline">/</span>
          <EditorSwitcher
            functions={functions}
            libraries={libraries}
            active={`function:${fn?.id ?? "new"}`}
            dirty={dirty}
            canManage={canEdit}
          />
          {fn && <Badge>v{fn.version}</Badge>}
          {dirty && (
            <Badge tone="warning">
              <Circle size={7} fill="currentColor" /> Unsaved
            </Badge>
          )}
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={validate}
              loading={busy === "validate"}
            >
              <ShieldCheck size={13} /> Validate
            </Button>
            <Button
              size="sm"
              onClick={save}
              loading={busy === "save"}
              disabled={!canEdit || !draft.name || !draft.slug || !schemas}
            >
              <Save size={13} /> Save to development
            </Button>
          </div>
        </header>
        <div className="grid min-h-[calc(100vh-166px)] grid-cols-1 xl:grid-cols-[270px_minmax(520px,1fr)_310px]">
          <aside className="border-r bg-card p-4">
            <h2 className="mb-4 text-xs font-semibold">Function settings</h2>
            <Field label="Name">
              <input
                className="field"
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            </Field>
            <Field label="Slug">
              <input
                className="field font-mono"
                value={draft.slug}
                onChange={(event) => update({ slug: event.target.value })}
                readOnly={Boolean(fn)}
              />
            </Field>
            <Field label="Title">
              <input
                className="field"
                value={draft.title}
                onChange={(event) => update({ title: event.target.value })}
              />
            </Field>
            <Field label="Description">
              <textarea
                className="field min-h-20"
                value={draft.description}
                onChange={(event) =>
                  update({ description: event.target.value })
                }
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
            <Field label="Required permissions" hint="Comma separated">
              <input
                className="field font-mono"
                value={draft.permissions}
                onChange={(event) =>
                  update({ permissions: event.target.value })
                }
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
            <h3 className="mb-2 text-[11px] font-semibold">
              Secret grants by name
            </h3>
            <div className="max-h-36 space-y-1 overflow-auto">
              {secrets.map((secret) => (
                <label
                  key={secret.id}
                  className="flex items-center gap-2 text-[11px]"
                >
                  <input
                    type="checkbox"
                    checked={draft.secretGrantIds.includes(secret.id)}
                    onChange={(event) =>
                      update({
                        secretGrantIds: event.target.checked
                          ? [...draft.secretGrantIds, secret.id]
                          : draft.secretGrantIds.filter(
                              (id) => id !== secret.id,
                            ),
                      })
                    }
                  />
                  <code>{secret.name}</code>
                </label>
              ))}
            </div>
          </aside>
          <main className="flex min-w-0 flex-col border-r">
            <div className="h-10 border-b bg-card px-3 py-3 text-[11px]">
              {draft.slug || "function"}.ts
            </div>
            <div className="min-h-[560px] flex-1">
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
            </div>
            <section className="border-t bg-card p-4">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-xs font-semibold">
                    <Beaker size={13} /> Test saved development version
                  </h2>
                  <p className="mt-1 max-w-3xl text-[11px] leading-5 text-muted-foreground">
                    Executes the latest saved Function version. The selected
                    endpoint supplies development secrets, network policy,
                    storage, and cache; its deployed Function code is not used.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={test}
                  loading={busy === "test"}
                  disabled={!fn || !endpointId || dirty}
                >
                  Test Function
                </Button>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <Field label="Development capability endpoint">
                    <select
                      className="field"
                      value={endpointId}
                      onChange={(event) => setEndpointId(event.target.value)}
                    >
                      <option value="">Select development endpoint</option>
                      {endpoints
                        .filter(
                          (endpoint) =>
                            endpoint.environment.slug === "development" &&
                            endpoint.activeDeployment,
                        )
                        .map((endpoint) => (
                          <option value={endpoint.id} key={endpoint.id}>
                            {endpoint.name} · v
                            {endpoint.activeDeployment?.version}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Caller permissions" hint="Comma separated">
                    <input
                      className="field font-mono"
                      value={testPermissions}
                      onChange={(event) =>
                        setTestPermissions(event.target.value)
                      }
                    />
                  </Field>
                  {dirty && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      Save changes to development before testing.
                    </p>
                  )}
                </div>
                <Field label="Input">
                  <textarea
                    className="field min-h-32 font-mono text-[10px]"
                    value={testInput}
                    onChange={(event) => setTestInput(event.target.value)}
                  />
                </Field>
              </div>
              {testResult !== undefined && (
                <div className="mt-1">
                  <span className="label">Result</span>
                  <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-[10px]">
                    {JSON.stringify(testResult, null, 2)}
                  </pre>
                </div>
              )}
            </section>
          </main>
          <aside className="space-y-5 bg-card p-4">
            <section>
              <h2 className="mb-3 text-xs font-semibold">JSON Schemas</h2>
              <Field label="Input schema">
                <textarea
                  className="field min-h-40 font-mono text-[10px]"
                  value={draft.inputSchema}
                  onChange={(event) =>
                    update({ inputSchema: event.target.value })
                  }
                />
              </Field>
              <Field label="Output schema">
                <textarea
                  className="field min-h-40 font-mono text-[10px]"
                  value={draft.outputSchema}
                  onChange={(event) =>
                    update({ outputSchema: event.target.value })
                  }
                />
              </Field>
              {!schemas && (
                <p className="text-xs text-red-500">Schema JSON is invalid.</p>
              )}
            </section>
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

function list(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
