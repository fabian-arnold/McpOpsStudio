"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { BeforeMount, OnMount } from "@monaco-editor/react";
import { LoaderCircle } from "lucide-react";
import type { OpsFunction, ProjectLibrary } from "@/lib/types";

const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-xs text-muted-foreground">
      <LoaderCircle className="mr-2 animate-spin" size={16} />
      Loading TypeScript editor…
    </div>
  ),
});

type JsonSchema = {
  properties?: Record<
    string,
    { type?: string | string[]; description?: string; enum?: unknown[] }
  >;
  required?: string[];
};

type TextModel = { getLineContent(lineNumber: number): string };
type EditorPosition = { lineNumber: number; column: number };

const storageCompletions = [
  {
    label: "get",
    detail: "get<T = unknown>(key: string): Promise<T | null>",
    documentation: "Read a value from Function-scoped persistent storage.",
  },
  {
    label: "list",
    detail:
      "list(pattern: string, options?: { limit?: number }): Promise<Array<{ key: string; value: unknown }>>",
    documentation:
      "List matching values with one optional * wildcard, for example note:*.",
  },
  {
    label: "set",
    detail:
      "set(key: string, value: JsonValue, options?: { ttlSeconds?: number }): Promise<void>",
    documentation: "Store a JSON value in Function-scoped persistent storage.",
  },
  {
    label: "delete",
    detail: "delete(key: string): Promise<void>",
    documentation: "Delete a value from Function-scoped persistent storage.",
  },
  {
    label: "deleteMany",
    detail:
      "deleteMany(pattern: string, options?: { limit?: number }): Promise<number>",
    documentation:
      "Delete matching values with one optional * wildcard and return the deleted count.",
  },
  {
    label: "forTenant",
    detail: "forTenant(tenantId: string): ScopedStorage",
    documentation: "Create a storage view scoped to an explicit tenant.",
  },
] as const;

const runtimeTypes = `
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type RuntimeContext = {
  invocation: { source: "mcp" | "http" | "cron" | "test" | "internal"; requestId: string; correlationId?: string; simulatedSource?: "mcp" | "http" | "cron" };
  trigger: { type: "endpoint"; source: "mcp" | "http" | "test"; endpoint: { id: string; slug: string; name: string; kind: "mcp" | "http" } } | { type: "cron"; binding: { id: string; name: string }; scheduledAt: string; triggeredAt: string; expression: string; timezone: string; origin: "scheduled" | "manual" };
  project: { id: string; slug: string; name: string };
  environment: { id: string; slug: string; name: string };
  endpoint?: { id: string; slug: string; name: string; kind: "mcp" | "http" };
  function: { id: string; name: string; riskLevel: "read" | "write" | "destructive" };
  caller: { subject?: string; email?: string; name?: string; tenantId?: string; permissions: string[]; claims: Record<string, unknown> };
  tenant?: { id: string };
  permissions: string[];
  env: Record<string, string>;
  secrets: { get(name: string): string };
  logger: { debug(message: string, metadata?: unknown): void; info(message: string, metadata?: unknown): void; warn(message: string, metadata?: unknown): void; error(message: string, metadata?: unknown): void };
  http: { request<T = unknown>(request: { method: string; url: string; headers?: Record<string, string>; query?: Record<string, unknown>; body?: unknown; timeoutMs?: number; tls?: { rejectUnauthorized: boolean } }): Promise<{ data: T; status?: number; headers?: Record<string, string> }> };
  storage: { get<T = unknown>(key: string): Promise<T | null>; list<T = unknown>(pattern: string, options?: { limit?: number }): Promise<Array<{ key: string; value: T }>>; set(key: string, value: JsonValue, options?: { ttlSeconds?: number }): Promise<void>; delete(key: string): Promise<void>; deleteMany(pattern: string, options?: { limit?: number }): Promise<number>; forTenant(tenantId: string): RuntimeContext["storage"] };
  cache: { get<T = unknown>(key: string): Promise<T | null>; set(key: string, value: JsonValue, options?: { ttlSeconds?: number }): Promise<void>; getOrSet<T>(key: string, factory: () => Promise<T>, options: { ttlSeconds: number }): Promise<T> };
  collections: { collection<T extends Record<string, unknown> = Record<string, unknown>>(slug: string): { create(data: T): Promise<{ id: string; data: T; revision: number; createdAt: string; updatedAt: string }>; get(id: string, options?: { select?: string[] }): Promise<{ id: string; data: T; revision: number; createdAt: string; updatedAt: string } | null>; query(query?: { where?: unknown; orderBy?: Array<{ field: string; direction?: "asc" | "desc" }>; select?: string[]; limit?: number; cursor?: string }): Promise<{ items: Array<{ id: string; data: Partial<T>; revision: number; createdAt: string; updatedAt: string }>; nextCursor?: string }>; count(options?: { where?: unknown }): Promise<number>; update(id: string, data: T, options: { revision: number }): Promise<{ id: string; data: T; revision: number; createdAt: string; updatedAt: string }>; delete(id: string, options: { revision: number }): Promise<void> } };
  functions: { call<Name extends keyof ProjectFunctionMap>(name: Name, input: ProjectFunctionMap[Name]["input"]): Promise<ProjectFunctionMap[Name]["output"]> };
  audit: { write(event: { action: string; targetType: string; targetId?: string; metadata?: Record<string, unknown> }): Promise<void> };
  db: { query(input: { connection: string; queryId: string; params: Record<string, unknown> }): Promise<unknown> };
  abortSignal: AbortSignal;
};
declare module "@mcpops/shared/auth" {
  export function requirePermission(ctx: RuntimeContext, permission: string): void;
}
declare module "@mcpops/shared/http" {
  export function safeJson(value: unknown): JsonValue;
}
declare module "@mcpops/shared/microsoft" {
  export function graphRequest<T = unknown>(ctx: RuntimeContext, request: { method?: string; path: string; body?: unknown }): Promise<T>;
}
`;

function identifier(value: string) {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}

function libraryDeclarations(libraries: ProjectLibrary[]) {
  return libraries
    .map((library) => {
      const exports = (library.exportedFunctions ?? []).filter(identifier);
      return `declare module ${JSON.stringify(library.importPath)} {\n${exports
        .map((name) => `  export function ${name}(...args: unknown[]): unknown;`)
        .join("\n")}\n}`;
    })
    .join("\n");
}

function schemaType(property: NonNullable<JsonSchema["properties"]>[string]) {
  if (property.enum?.length)
    return property.enum.map((value) => JSON.stringify(value)).join(" | ");
  const types = Array.isArray(property.type)
    ? property.type
    : [property.type ?? "unknown"];
  return types
    .map((type) => {
      if (type === "string" || type === "boolean" || type === "number") return type;
      if (type === "integer") return "number";
      if (type === "null") return "null";
      if (type === "array") return "unknown[]";
      if (type === "object") return "Record<string, unknown>";
      return "unknown";
    })
    .join(" | ");
}

function functionInputDeclaration(schema: JsonSchema) {
  return `type FunctionInput = ${schemaObjectType(schema)};`;
}

function schemaObjectType(schema: JsonSchema) {
  const required = new Set(schema.required ?? []);
  const properties = Object.entries(schema.properties ?? {}).map(
    ([name, property]) =>
      `  ${JSON.stringify(name)}${required.has(name) ? "" : "?"}: ${schemaType(property)};`,
  );
  return `{\n${properties.join("\n")}\n}`;
}

function projectFunctionDeclarations(functions: OpsFunction[]) {
  const entries = functions.map(
    (fn) =>
      `  ${JSON.stringify(fn.slug)}: { input: ${schemaObjectType(fn.inputSchema as JsonSchema)}; output: ${schemaObjectType(fn.outputSchema as JsonSchema)} };`,
  );
  return `type ProjectFunctionMap = {\n${entries.join("\n")}\n};`;
}

export function TypeScriptEditor({
  value,
  onChange,
  path,
  libraries = [],
  functions = [],
  inputSchema,
  runtimeContext = false,
  height = "100%",
  readOnly = false,
}: {
  value: string;
  onChange?: (value: string) => void;
  path: string;
  libraries?: ProjectLibrary[];
  functions?: OpsFunction[];
  inputSchema?: JsonSchema;
  runtimeContext?: boolean;
  height?: string | number;
  readOnly?: boolean;
}) {
  const completionDisposable = useRef<{ dispose(): void } | undefined>(undefined);
  const libraryDisposable = useRef<{ dispose(): void } | undefined>(undefined);
  const schema = useMemo(() => inputSchema ?? {}, [inputSchema]);
  useEffect(
    () => () => {
      completionDisposable.current?.dispose();
      libraryDisposable.current?.dispose();
    },
    [],
  );

  const beforeMount = useCallback<BeforeMount>(
    (monaco) => {
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2022,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        allowNonTsExtensions: true,
        strict: true,
        noEmit: true,
      });
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
      });
      libraryDisposable.current?.dispose();
      libraryDisposable.current =
        monaco.languages.typescript.typescriptDefaults.addExtraLib(
          `${runtimeTypes}\n${functionInputDeclaration(schema)}\n${projectFunctionDeclarations(functions)}\n${libraryDeclarations(libraries)}`,
          "file:///mcpops/runtime.d.ts",
        );
    },
    [functions, libraries, schema],
  );

  const onMount = useCallback<OnMount>(
    (_editor, monaco) => {
      completionDisposable.current?.dispose();
      completionDisposable.current = monaco.languages.registerCompletionItemProvider(
        "typescript",
        {
          triggerCharacters: ["."],
          provideCompletionItems(model: TextModel, position: EditorPosition) {
            const prefix = model
              .getLineContent(position.lineNumber)
              .slice(0, position.column - 1);
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: position.column,
              endColumn: position.column,
            };
            if (/\binput\.$/.test(prefix)) {
              return {
                suggestions: Object.entries(schema.properties ?? {}).map(
                  ([name, property]) => ({
                    label: name,
                    kind: monaco.languages.CompletionItemKind.Property,
                    insertText: name,
                    range,
                    detail: `${Array.isArray(property.type) ? property.type.join(" | ") : (property.type ?? "unknown")}${schema.required?.includes(name) ? " (required)" : ""}`,
                    documentation: property.description,
                  }),
                ),
              };
            }
            if (runtimeContext && /\bctx\.$/.test(prefix)) {
              return {
                suggestions: [
                  "invocation",
                  "project",
                  "environment",
                  "endpoint",
                  "function",
                  "caller",
                  "tenant",
                  "permissions",
                  "env",
                  "secrets",
                  "logger",
                  "http",
                  "storage",
                  "cache",
                  "collections",
                  "functions",
                  "audit",
                  "db",
                  "abortSignal",
                ].map((name) => ({
                  label: name,
                  kind: monaco.languages.CompletionItemKind.Property,
                  insertText: name,
                  range,
                  detail: "RuntimeContext",
                })),
              };
            }
            if (runtimeContext && /\bctx\.storage\.$/.test(prefix)) {
              return {
                suggestions: storageCompletions.map((completion) => ({
                  ...completion,
                  kind: monaco.languages.CompletionItemKind.Method,
                  insertText: completion.label,
                  range,
                })),
              };
            }
            return { suggestions: [] };
          },
        },
      );
    },
    [runtimeContext, schema],
  );

  return (
    <Monaco
      height={height}
      path={path}
      language="typescript"
      theme={
        typeof document !== "undefined" &&
        document.documentElement.classList.contains("dark")
          ? "vs-dark"
          : "light"
      }
      value={value}
      onChange={(next) => onChange?.(next ?? "")}
      beforeMount={beforeMount}
      onMount={onMount}
      options={{
        fontSize: 12,
        lineHeight: 21,
        minimap: { enabled: false },
        padding: { top: 14 },
        wordWrap: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        renderLineHighlight: "gutter",
        foldingHighlight: false,
        overviewRulerBorder: false,
        quickSuggestions: { other: true, comments: false, strings: false },
        suggestOnTriggerCharacters: true,
        tabCompletion: "on",
        readOnly,
      }}
    />
  );
}
