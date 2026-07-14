"use client";
import { Beaker, TerminalSquare, WandSparkles } from "lucide-react";
import { PermissionAutocomplete } from "@/components/permission-autocomplete";
import {
  generateExampleFromSchema,
  SchemaDrivenInput,
} from "@/components/schema-input-tools";
import { Badge, Button } from "@/components/ui";
import { ConsolePayload } from "@/features/functions/function-workbench-components";

import type { FunctionWorkbenchModel } from "./use-function-workbench";

export function FunctionTestConsole({ model }: { model: FunctionWorkbenchModel }) {
  const {
    workbenchLayout,
    testConsoleTab,
    setTestConsoleTab,
    testLogs,
    testRecord,
    dirty,
    test,
    busy,
    canOperate,
    fn,
    endpointId,
    endpoints,
    setEndpointId,
    testSource,
    setTestSource,
    testSubject,
    setTestSubject,
    testPermissions,
    permissionSuggestions,
    draft,
    setTestPermissions,
    testInputMode,
    setTestInputMode,
    schemas,
    setTestInput,
    testInput,
  } = model;
  return (
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
            <Badge tone={testRecord.status === "success" ? "success" : "danger"}>
              {testRecord.status}
            </Badge>
          )}
          {typeof testRecord.durationMs === "number" && (
            <span className="text-[10px] text-muted-foreground">
              {testRecord.durationMs} ms
            </span>
          )}
          {dirty && (
            <span className="text-[10px] text-amber-600">Save before testing</span>
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
                  ...new Set([...permissionSuggestions, ...(draft?.permissions ?? [])]),
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
                      JSON.stringify(generateExampleFromSchema(schemas.input), null, 2),
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
                  <span className="uppercase">{String(log.level ?? "info")}</span>
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
  );
}
