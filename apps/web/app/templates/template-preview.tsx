"use client";
import { Badge } from "@/components/ui";
import type { Preview } from "./template-types";

export function PreviewResult({ preview }: { preview: Preview }) {
  const knownBlockers = [
    ...(preview.missingSecrets ?? []).map((value) => `Missing secret: ${value}`),
    ...(preview.missingHosts ?? []).map((value) => `Missing allowed host: ${value}`),
    ...(preview.missingCapabilities ?? []).map(
      (value) => `Missing capability: ${value}`,
    ),
    ...(preview.policyBlockers ?? []),
  ];
  return (
    <div
      className={
        preview.installable
          ? "rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4"
          : "rounded-lg border border-amber-500/20 bg-amber-500/5 p-4"
      }
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">
          {preview.installable ? "Installation is ready" : "Installation is blocked"}
        </p>
        <Badge tone={preview.installable ? "success" : "warning"}>
          {preview.draft?.enabled ? "Enabled draft" : "Disabled draft"}
        </Badge>
      </div>
      {knownBlockers.length > 0 && (
        <ul className="mt-3 list-inside list-disc text-[11px] text-muted-foreground">
          {knownBlockers.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {preview.warnings?.length ? (
        <ul className="mt-3 list-inside list-disc text-[11px] text-muted-foreground">
          {preview.warnings.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer text-[10px] font-medium">
          Exact server preview
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-[#0b0d14] p-2 font-mono text-[9px] text-slate-300">
          {JSON.stringify(preview.exactChanges ?? preview.blockers ?? preview, null, 2)}
        </pre>
      </details>
    </div>
  );
}
export function DocList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="font-semibold text-foreground">{title}</p>
      <ul className="mt-1 list-inside list-disc">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
