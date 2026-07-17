"use client";
import { Braces, Link2, Settings2 } from "lucide-react";
import { PermissionAutocomplete } from "@/components/permission-autocomplete";
import { SchemaDefinitionEditor } from "@/components/schema-input-tools";
import { Skeleton } from "@/components/ui";
import {
  Field,
  FunctionBindings,
  functionSlug,
} from "@/features/functions/function-workbench-components";
import { type Draft } from "@/features/functions/function-workbench-types";

import type { FunctionWorkbenchModel } from "./use-function-workbench";

export function FunctionInspector({ model }: { model: FunctionWorkbenchModel }) {
  const {
    draft,
    inspectorTab,
    setInspectorTab,
    fn,
    slugManuallyEdited,
    setSlugManuallyEdited,
    update,
    permissionSuggestions,
    logicalSecrets,
    secrets,
    schemas,
    endpoints,
    functions,
    canEdit,
    bindingBusyId,
    refreshFunctionMetadata,
    toggleBinding,
    removeBinding,
  } = model;
  return (
    <aside className="border-t bg-card xl:overflow-hidden xl:border-l xl:border-t-0">
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
      <div className="overflow-auto p-4 xl:max-h-[calc(100vh-205px)]">
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
                    ...(!fn && !slugManuallyEdited ? { slug: functionSlug(name) } : {}),
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
                  min={100}
                  max={3_600_000}
                  step={1_000}
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
              One grant per project Secret name; runtime values still resolve from the
              selected endpoint environment.
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
                                    secrets.find((candidate) => candidate.id === id)
                                      ?.name !== secret.name,
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
  );
}
