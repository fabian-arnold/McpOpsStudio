"use client";

import { useEffect, useState } from "react";
import { PlugZap, Trash2 } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Badge, Button, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Grant = {
  id: string;
  clientName: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
};

export default function McpAccessPage() {
  const [grants, setGrants] = useState<Grant[]>();
  const [error, setError] = useState<string>();
  const endpoint =
    typeof window === "undefined"
      ? "/platform/mcp"
      : `${window.location.origin}/platform/mcp`;
  const load = () =>
    api<Grant[]>("/api/oauth/grants")
      .then(setGrants)
      .catch((reason) => setError(errorMessage(reason)));
  useEffect(() => {
    void load();
  }, []);
  async function revoke(id: string) {
    await api(`/api/oauth/grants/${id}`, { method: "DELETE" });
    await load();
  }
  return (
    <AppShell>
      <PageHeader
        eyebrow="Developer tools"
        title="IDE access"
        description="Connect coding agents to the OAuth-protected platform MCP server."
      />
      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <section className="panel p-5">
          <div className="flex items-center gap-2">
            <PlugZap size={16} className="text-primary" />
            <h2 className="text-sm font-semibold">Platform MCP endpoint</h2>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Configure this Streamable HTTP URL in your MCP client. The client opens a
            browser for local platform sign-in and approval; no runtime API key is used.
          </p>
          <code className="mt-4 block overflow-x-auto rounded-lg bg-muted p-3 text-xs">
            {endpoint}
          </code>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Durable mutations preview by default. Use <code>project_select</code> once
            after every MCP initialization.
          </p>
        </section>
        <section className="panel p-5">
          <h2 className="text-sm font-semibold">Authorized clients</h2>
          {error && <p className="mt-4 text-xs text-red-500">{error}</p>}
          {!grants && !error && <Skeleton className="mt-4 h-32" />}
          {grants?.length === 0 && (
            <EmptyState
              icon={<PlugZap size={20} />}
              title="No authorized clients"
              description="Clients appear here after browser approval."
            />
          )}
          {grants?.map((grant) => (
            <div className="mt-4 rounded-lg border p-3" key={grant.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold">{grant.clientName}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {grant.scopes.map((scope) => (
                      <Badge key={scope}>{scope}</Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Expires {new Date(grant.expiresAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  aria-label="Revoke client"
                  size="icon"
                  variant="ghost"
                  onClick={() => void revoke(grant.id)}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
