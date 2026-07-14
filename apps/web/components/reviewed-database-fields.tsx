"use client";

export function SchemaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <textarea
        className="field min-h-24 font-mono text-[11px]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="field"
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
export function JsonSummary({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="rounded border bg-card p-2">
      <summary className="cursor-pointer text-[10px] font-medium">{label}</summary>
      <pre className="mt-2 max-h-32 overflow-auto font-mono text-[9px] leading-4 text-muted-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
export function FormError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
      {message}
    </div>
  );
}
export function parseObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object`);
  return parsed as Record<string, unknown>;
}
export function formatBytes(value: number) {
  return value >= 1_048_576
    ? `${(value / 1_048_576).toFixed(1)} MiB`
    : `${Math.round(value / 1024)} KiB`;
}
