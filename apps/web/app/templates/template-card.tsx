"use client";
import { KeyRound, Wrench } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { TemplateInstallDialog } from "./template-install-dialog";
import { DocList } from "./template-preview";
import { icons, type Template } from "./template-types";

export function TemplateCard({
  template,
  endpointId,
  endpointName,
}: {
  template: Template;
  endpointId: string;
  endpointName: string | undefined;
}) {
  const Icon = icons[template.id as keyof typeof icons] ?? Wrench;
  const bindings = [
    template.bindings.mcp ? "MCP" : null,
    template.bindings.http ? "HTTP" : null,
  ].filter((value): value is string => Boolean(value));
  const unavailable = template.availability.status === "provider_unavailable";
  return (
    <article className="panel flex flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon size={18} />
        </span>
        <Badge
          tone={
            template.availability.status === "ready"
              ? "success"
              : template.availability.status === "requires_configuration"
                ? "warning"
                : "danger"
          }
        >
          {template.availability.status === "ready"
            ? "Ready to preview"
            : template.availability.status === "requires_configuration"
              ? "Setup required"
              : "Provider unavailable"}
        </Badge>
      </div>
      <h2 className="mt-4 text-sm font-semibold">{template.name}</h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {template.description}
      </p>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {template.availability.message}
      </p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {bindings.map((binding) => (
          <Badge tone={binding === "MCP" ? "primary" : "info"} key={binding}>
            {binding}
          </Badge>
        ))}
        <Badge>
          <KeyRound size={10} />
          {template.secrets.length} secrets
        </Badge>
        {template.localExample && <Badge tone="warning">Synthetic local example</Badge>}
      </div>
      <details className="mt-4 rounded-lg border p-3">
        <summary className="cursor-pointer text-xs font-semibold">
          Documentation and setup
        </summary>
        <div className="mt-3 space-y-4 text-[11px] leading-5 text-muted-foreground">
          <p>{template.documentation.purpose}</p>
          <DocList title="Setup" items={template.documentation.setup} />
          <DocList
            title="Permissions"
            items={template.documentation.requirements.permissions}
          />
          <DocList
            title="Secrets"
            items={template.documentation.requirements.secrets}
          />
          <DocList
            title="Network hosts"
            items={template.documentation.requirements.networkHosts}
          />
          <DocList
            title="Capabilities"
            items={template.documentation.requirements.capabilities}
          />
          <div>
            <p className="font-semibold text-foreground">Example calls</p>
            <pre className="mt-1 max-h-36 overflow-auto rounded bg-[#0b0d14] p-2 font-mono text-[9px] text-slate-300">
              {JSON.stringify(template.documentation.exampleCalls, null, 2)}
            </pre>
          </div>
          <div>
            <p className="font-semibold text-foreground">Expected output</p>
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-[#0b0d14] p-2 font-mono text-[9px] text-slate-300">
              {JSON.stringify(template.documentation.expectedOutput, null, 2)}
            </pre>
          </div>
          <DocList title="Limitations" items={template.documentation.limitations} />
        </div>
      </details>
      {unavailable ? (
        <Button
          variant="secondary"
          className="mt-5 w-full"
          disabled
          title={template.availability.message}
        >
          Provider unavailable
        </Button>
      ) : (
        <TemplateInstallDialog
          template={template}
          endpointId={endpointId}
          endpointName={endpointName}
        />
      )}
    </article>
  );
}
