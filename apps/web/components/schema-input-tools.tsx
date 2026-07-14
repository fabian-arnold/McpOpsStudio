"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Braces, FileJson, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui";

type JsonSchema = Record<string, unknown>;

export function SchemaDrivenInput({
  schema,
  value,
  onChange,
}: {
  schema: JsonSchema;
  value: string;
  onChange: (value: string) => void;
}) {
  const parsed = useMemo(() => parseObject(value), [value]);
  const properties = record(schema.properties);
  const required = new Set(stringArray(schema.required));
  const entries = Object.entries(properties);

  if (!entries.length)
    return <p className="rounded-lg border p-3 text-xs text-muted-foreground">Add properties to the input schema to generate form fields. Raw JSON remains available.</p>;

  function updateProperty(name: string, propertySchema: JsonSchema, raw: string | boolean) {
    const next = { ...parsed };
    const nextValue = coerceFormValue(raw, propertySchema);
    if (nextValue === undefined) delete next[name];
    else next[name] = nextValue;
    onChange(JSON.stringify(next, null, 2));
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {entries.map(([name, rawProperty]) => {
        const property = record(rawProperty);
        const type = schemaType(property);
        const current = parsed[name];
        const options = Array.isArray(property.enum) ? property.enum : undefined;
        return (
          <label key={name} className={type === "object" || type === "array" ? "md:col-span-2" : ""}>
            <span className="label">{humanize(name)}{required.has(name) ? " *" : ""}</span>
            {options ? (
              <select className="field" value={current == null ? "" : String(current)} onChange={(event) => updateProperty(name, property, event.target.value)}>
                {!required.has(name) && <option value="">Not set</option>}
                {options.map((option) => <option key={JSON.stringify(option)} value={String(option)}>{String(option)}</option>)}
              </select>
            ) : type === "boolean" ? (
              <select className="field" value={current == null ? "" : String(current)} onChange={(event) => updateProperty(name, property, event.target.value)}>
                {!required.has(name) && <option value="">Not set</option>}
                <option value="true">true</option><option value="false">false</option>
              </select>
            ) : type === "object" || type === "array" ? (
              <textarea className="field min-h-20 font-mono text-[11px]" value={current == null ? "" : JSON.stringify(current, null, 2)} placeholder={type === "array" ? "[]" : "{}"} onChange={(event) => updateProperty(name, property, event.target.value)} />
            ) : (
              <input className="field" type={type === "number" || type === "integer" ? "number" : property.format === "date" ? "date" : property.format === "date-time" ? "datetime-local" : "text"} value={current == null ? "" : String(current)} placeholder={typeof property.description === "string" ? property.description : undefined} onChange={(event) => updateProperty(name, property, event.target.value)} />
            )}
            {typeof property.description === "string" && <span className="mt-1 block text-[10px] text-muted-foreground">{property.description}</span>}
          </label>
        );
      })}
    </div>
  );
}

export function SchemaDefinitionEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [mode, setMode] = useState<"schema" | "example">("schema");
  const [example, setExample] = useState("{}");
  const [error, setError] = useState<string>();
  const previousSchema = useRef(isAnySchema(value) ? defaultObjectSchema() : value);
  const allowAny = useMemo(() => isAnySchema(value), [value]);

  useEffect(() => {
    if (!allowAny) previousSchema.current = value;
  }, [allowAny, value]);

  function infer() {
    try {
      const parsed = JSON.parse(example) as unknown;
      onChange(JSON.stringify(inferSchemaFromExample(parsed), null, 2));
      setError(undefined);
      setMode("schema");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Example must be valid JSON.");
    }
  }

  function generate() {
    try {
      const schema = JSON.parse(value) as JsonSchema;
      setExample(JSON.stringify(generateExampleFromSchema(schema), null, 2));
      setError(undefined);
      setMode("example");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Schema must be valid JSON.");
    }
  }

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center gap-1">
        <h3 className="mr-auto text-[11px] font-semibold">{label}</h3>
        {!allowAny && <><button type="button" onClick={() => setMode("schema")} className={`rounded px-2 py-1 text-[10px] ${mode === "schema" ? "bg-muted" : "text-muted-foreground"}`}><Braces size={11} className="mr-1 inline" />Schema</button>
        <button type="button" onClick={() => setMode("example")} className={`rounded px-2 py-1 text-[10px] ${mode === "example" ? "bg-muted" : "text-muted-foreground"}`}><FileJson size={11} className="mr-1 inline" />Example</button></>}
      </div>
      <label className="mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px]">
        <input
          type="checkbox"
          checked={allowAny}
          onChange={(event) => {
            setError(undefined);
            onChange(event.target.checked ? "{}" : previousSchema.current || defaultObjectSchema());
          }}
        />
        <span><strong>Allow any</strong><span className="ml-1 text-muted-foreground">Skip schema constraints for this value.</span></span>
      </label>
      {allowAny ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-[11px] text-amber-700 dark:text-amber-300">Any valid JSON value is accepted. Runtime schema validation is intentionally unrestricted.</div>
      ) : mode === "schema" ? (
        <><textarea className="field min-h-52 font-mono text-[10px]" value={value} onChange={(event) => onChange(event.target.value)} /><Button size="sm" variant="ghost" className="mt-1" onClick={generate}><WandSparkles size={11} /> Generate example</Button></>
      ) : (
        <><textarea className="field min-h-40 font-mono text-[10px]" value={example} onChange={(event) => setExample(event.target.value)} /><Button size="sm" variant="secondary" className="mt-1" onClick={infer}><WandSparkles size={11} /> Infer schema from example</Button></>
      )}
      {error && <p className="mt-1 text-[10px] text-red-500">{error}</p>}
    </section>
  );
}

export function generateExampleFromSchema(schema: JsonSchema): unknown {
  if (!Object.keys(schema).length) return {};
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) return generateExampleFromSchema(record(schema.oneOf[0]));
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) return generateExampleFromSchema(record(schema.anyOf[0]));
  switch (schemaType(schema)) {
    case "object": return Object.fromEntries(Object.entries(record(schema.properties)).map(([name, child]) => [name, generateExampleFromSchema(record(child))]));
    case "array": return [generateExampleFromSchema(record(schema.items))];
    case "boolean": return false;
    case "integer": case "number": return typeof schema.minimum === "number" ? schema.minimum : 0;
    case "null": return null;
    default:
      if (schema.format === "date") return "2026-01-01";
      if (schema.format === "date-time") return "2026-01-01T00:00:00.000Z";
      if (schema.format === "email") return "user@example.com";
      if (schema.format === "uri") return "https://example.com";
      return "string";
  }
}

export function inferSchemaFromExample(value: unknown): JsonSchema {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) return { type: "array", items: value.length ? inferSchemaFromExample(value[0]) : {} };
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      type: "object",
      properties: Object.fromEntries(entries.map(([name, child]) => [name, inferSchemaFromExample(child)])),
      required: entries.map(([name]) => name),
      additionalProperties: false,
    };
  }
  return { type: typeof value === "number" ? (Number.isInteger(value) ? "integer" : "number") : typeof value };
}

function coerceFormValue(value: string | boolean, schema: JsonSchema): unknown {
  if (value === "") return undefined;
  const type = schemaType(schema);
  if (type === "boolean") return value === true || value === "true";
  if (type === "integer") return Number.parseInt(String(value), 10);
  if (type === "number") return Number(String(value));
  if (type === "object" || type === "array") {
    try { return JSON.parse(String(value)) as unknown; } catch { return value; }
  }
  return value;
}

function schemaType(schema: JsonSchema): string {
  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== "null") : schema.type;
  return typeof type === "string" ? type : schema.properties ? "object" : "string";
}

function parseObject(value: string): Record<string, unknown> {
  try { return record(JSON.parse(value)); } catch { return {}; }
}

function record(value: unknown): JsonSchema {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonSchema : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function humanize(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

function isAnySchema(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed) && !Object.keys(parsed).length);
  } catch {
    return false;
  }
}

function defaultObjectSchema() {
  return JSON.stringify({ type: "object", properties: {}, additionalProperties: false }, null, 2);
}
