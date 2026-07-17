"use client";

import { useState } from "react";
import { Copy, ExternalLink, FileText, Terminal } from "lucide-react";
import { useToast } from "@/components/providers";
import { Button } from "@/components/ui";

type Client = "codex" | "claude" | "openai";

const clients: { id: Client; label: string }[] = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
  { id: "openai", label: "ChatGPT / OpenAI" },
];

const skill = `---
name: mcp-ops-studio
description: Operate MCP Ops Studio projects through its platform MCP server. Use for Functions, endpoints and bindings, Secrets and grants, authentication and network policies, testing, deployments, and runtime diagnostics.
---

# MCP Ops Studio

Use the MCP Ops Studio platform tools to configure and operate the selected project safely.

## Operating procedure

1. Start with \`projects_list\`, then call \`project_select\` before project-scoped work. The last selection is restored after reconnecting.
2. Inspect the current Function, endpoint, binding, Secret grants, and policies before changing them.
3. Use dry-run or preview modes for durable mutations when the tool provides one. Review the proposed change before applying it.
4. Create and rotate Secret values only with \`secret_set_value\`. Never repeat Secret values in chat, source, logs, execution input, or summaries.
5. Before enabling a binding or deploying an endpoint, assign an authentication policy and verify endpoint access and Function permissions.
6. Keep outbound network policies minimal: allow only the required hosts, methods, and ports. Do not enable private-network access unless the user explicitly requires and approves it.
   Disable TLS certificate verification only when the request requires it and the exact host is explicitly approved by the endpoint's \`allowInsecureTlsHosts\` policy. Prefer a trusted CA.
7. Validate or test the affected Function, then deploy the complete immutable Development snapshot. Inspect deployment status and failures before reporting success.
8. Ask for explicit confirmation before deleting resources, rotating an in-use Secret, releasing to Production, or rolling back.
9. Never claim a mutation or deployment succeeded when a tool returned an error, was cancelled, or has not completed.

## Safety

- Never request or expose encrypted or plaintext Secret values through list/get tools.
- Prefer logical names over hidden IDs when a tool supports them.
- Preserve project scoping and do not create tenant or project-membership layers.
- Functions are the executable unit; MCP tools and HTTP routes are bindings, not separate implementations.
- Draft source is not live until an immutable deployment snapshot becomes active.
`;

function CodeBlock({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied`, tone: "success" });
    } catch {
      toast({
        title: "Copy failed",
        description: "Copy the text manually.",
        tone: "error",
      });
    }
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-slate-950">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
          {label}
        </span>
        <Button onClick={() => void copy()} size="sm" variant="ghost">
          <Copy size={12} /> Copy
        </Button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap p-3 text-xs leading-5 text-slate-100">
        {value}
      </pre>
    </div>
  );
}

function ClientGuide({ client, endpoint }: { client: Client; endpoint: string }) {
  if (client === "codex") {
    return (
      <div className="space-y-3 text-xs text-muted-foreground">
        <p>Run this once. Codex detects OAuth and opens the browser approval flow.</p>
        <CodeBlock
          label="Terminal"
          value={`codex mcp add mcp-ops-studio --url ${endpoint}`}
        />
        <p>
          Alternatively add <code>[mcp_servers.mcp-ops-studio]</code> with this URL to
          <code> ~/.codex/config.toml</code>, then run{" "}
          <code>codex mcp login mcp-ops-studio</code>.
        </p>
      </div>
    );
  }
  if (client === "claude") {
    return (
      <div className="space-y-3 text-xs text-muted-foreground">
        <p>
          Add the remote HTTP server, then use <code>/mcp</code> inside Claude Code to
          sign in.
        </p>
        <CodeBlock
          label="Terminal"
          value={`claude mcp add --transport http --scope user mcp-ops-studio ${endpoint}`}
        />
        <p>
          Replace <code>--scope user</code> with <code>--scope project</code> to create
          a team-shareable <code>.mcp.json</code> in the repository.
        </p>
      </div>
    );
  }
  return (
    <ol className="list-decimal space-y-2 pl-4 text-xs text-muted-foreground">
      <li>
        In ChatGPT, enable developer mode under Settings → Apps → Advanced settings.
      </li>
      <li>Open Settings → Apps, choose Create, and enter the endpoint shown above.</li>
      <li>
        Choose OAuth authentication, scan the tools, and complete browser approval.
      </li>
      <li>
        Create the app, then enable it in the conversation where you want to use it.
      </li>
    </ol>
  );
}

export function McpClientSetup({ endpoint }: { endpoint: string }) {
  const [client, setClient] = useState<Client>("codex");
  return (
    <div className="space-y-5">
      <section className="panel overflow-hidden">
        <div className="border-b p-5">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-primary" />
            <h2 className="text-sm font-semibold">Client setup</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect a coding agent or ChatGPT app to the platform MCP endpoint.
          </p>
          <div className="mt-4 flex flex-wrap gap-2" role="tablist">
            {clients.map((item) => (
              <button
                aria-selected={client === item.id}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                  client === item.id
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                key={item.id}
                onClick={() => setClient(item.id)}
                role="tab"
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-5">
          <ClientGuide client={client} endpoint={endpoint} />
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-primary" />
          <h2 className="text-sm font-semibold">Reusable agent skill</h2>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Copy this <code>SKILL.md</code> so an agent knows when and how to operate the
          platform safely. The same content follows the Agent Skills format supported by
          Codex and Claude Code.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3 text-xs">
            <p className="font-semibold">Project skill</p>
            <p className="mt-1 text-muted-foreground">
              Codex: <code>.agents/skills/mcp-ops-studio/SKILL.md</code>
            </p>
            <p className="mt-1 text-muted-foreground">
              Claude: <code>.claude/skills/mcp-ops-studio/SKILL.md</code>
            </p>
          </div>
          <div className="rounded-lg border p-3 text-xs">
            <p className="font-semibold">Personal skill</p>
            <p className="mt-1 text-muted-foreground">
              Codex: <code>~/.agents/skills/mcp-ops-studio/SKILL.md</code>
            </p>
            <p className="mt-1 text-muted-foreground">
              Claude: <code>~/.claude/skills/mcp-ops-studio/SKILL.md</code>
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Create the directory, save the copied text as <code>SKILL.md</code>, and
          restart the client only if it does not detect the new top-level skill
          directory. For a ChatGPT app, put these operating rules in its workspace or
          agent instructions; ChatGPT does not read local skill folders.
        </p>
        <div className="mt-4">
          <CodeBlock label="SKILL.md" value={skill} />
        </div>
        <a
          className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          href="https://agentskills.io"
          rel="noreferrer"
          target="_blank"
        >
          Agent Skills format <ExternalLink size={11} />
        </a>
      </section>
    </div>
  );
}
