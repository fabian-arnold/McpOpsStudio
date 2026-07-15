"use client";

import Link from "next/link";
import { CalendarClock, Link2, Trash2 } from "lucide-react";
import {
  BindingEditorDialog,
  type EditableFunctionBinding,
} from "@/components/binding-editor-dialog";
import { Badge, Button, EmptyState } from "@/components/ui";
import type {
  FunctionDetail,
  FunctionHttpBinding,
  FunctionMcpBinding,
  OpsFunction,
  RuntimeEndpoint,
} from "@/lib/types";
import {
  defaultWorkbenchLayout,
  type StoredTestValues,
  type WorkbenchLayout,
  type WorkbenchPanel,
} from "./function-workbench-types";

export function FunctionBindings({
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
  const cron = fn.cronBindings ?? [];
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
          <div className="flex gap-2">
            <Link
              href={`/schedules?functionId=${fn.id}&create=1`}
              className="inline-flex h-8 items-center gap-2 rounded-lg border bg-card px-3 text-xs font-medium hover:bg-muted"
            >
              <CalendarClock size={12} /> Add cron
            </Link>
            <BindingEditorDialog
              endpoints={endpoints}
              functions={functions}
              fixedFunctionId={fn.id}
              onSaved={onChanged}
            />
          </div>
        )}
      </div>
      {!mcp.length && !http.length && !cron.length ? (
        <EmptyState
          icon={<Link2 />}
          title="Not exposed"
          description="Add an MCP tool, HTTP route, or cron binding for this Function."
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
          {cron.length > 0 && (
            <section>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Cron schedules
              </h3>
              <div className="space-y-2">
                {cron.map((binding) => (
                  <div key={binding.id} className="rounded-lg border p-3">
                    <div className="flex items-start gap-2">
                      <CalendarClock size={14} className="mt-0.5 text-primary" />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/schedules?bindingId=${binding.id}`}
                          className="text-[11px] font-semibold hover:text-primary"
                        >
                          {binding.name}
                        </Link>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                          {binding.expression} · {binding.timezone} ·{" "}
                          {binding.environment.name}
                        </p>
                      </div>
                      <Badge tone={binding.enabled ? "success" : "neutral"}>
                        {binding.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
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

export function BindingGroup({
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
                      href={`/endpoints/${endpoint.id}?tab=bindings`}
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

export function editableMcp(binding: FunctionMcpBinding): EditableFunctionBinding {
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

export function editableHttp(binding: FunctionHttpBinding): EditableFunctionBinding {
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

export function ResizeHandle({
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
      aria-valuemin={panel === "left" ? 190 : panel === "right" ? 280 : 180}
      aria-valuemax={panel === "left" ? 300 : panel === "right" ? 380 : 520}
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

export function Field({
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

export function ConsolePayload({
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

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readStoredTestValues(
  value: string | null,
): StoredTestValues | undefined {
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

export function readWorkbenchLayout(value: string | null): WorkbenchLayout {
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

export function clampPanelSize(panel: WorkbenchPanel, value: number) {
  const [minimum, maximum] =
    panel === "left" ? [190, 300] : panel === "right" ? [280, 380] : [180, 520];
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function functionSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function validFunctionSlug(value: string) {
  return (
    /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(value) &&
    value.length >= 2 &&
    value.length <= 80
  );
}
