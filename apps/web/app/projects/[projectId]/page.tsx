"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FolderKanban, Globe2, TerminalSquare } from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  Button,
  EmptyState,
  LoadError,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { EndpointCreateDialog } from "@/components/endpoint-create-dialog";
import { api, errorMessage } from "@/lib/api";
import type { ProjectSummary, RuntimeEndpoint, SessionIdentity } from "@/lib/types";

type ProjectDetail = ProjectSummary & {
  environments: Array<{ id: string; name: string; slug: string }>;
  endpoints: Array<
    RuntimeEndpoint & {
      _count: { functions: number; mcpToolBindings: number; httpRouteBindings: number };
    }
  >;
};

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectDetail>();
  const [me, setMe] = useState<SessionIdentity["user"]>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    Promise.all([
      api<ProjectDetail>(`/api/projects/${projectId}`),
      api<SessionIdentity>("/api/auth/me"),
    ])
      .then(([value, session]) => {
        setProject(value);
        setMe(session.user);
      })
      .catch((reason) => setError(errorMessage(reason)));
  }, [projectId]);
  useEffect(load, [load]);
  async function select() {
    await api(`/api/projects/${projectId}/select`, { method: "POST", body: "{}" });
    window.location.reload();
  }
  if (error)
    return (
      <AppShell>
        <LoadError title="Project unavailable" message={error} onRetry={load} />
      </AppShell>
    );
  if (!project)
    return (
      <AppShell>
        <Skeleton className="h-96" />
      </AppShell>
    );
  const selected = me?.project.id === project.id;
  return (
    <AppShell>
      <Link
        href="/projects"
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground"
      >
        <ArrowLeft size={13} /> Projects
      </Link>
      <PageHeader
        eyebrow={project.slug}
        title={project.name}
        description={project.description || "Project Functions and runtime endpoints."}
        actions={
          selected ? (
            <>
              <EndpointCreateDialog kind="mcp" onCreated={load} />
              <EndpointCreateDialog kind="http" variant="secondary" onCreated={load} />
            </>
          ) : (
            <Button onClick={() => void select()}>Select project</Button>
          )
        }
      />
      <div className="mb-5 flex gap-2">
        <Badge tone={project.status === "active" ? "success" : "neutral"}>
          {project.status}
        </Badge>
        <Badge>{project.environments.length} environments</Badge>
        <Badge>{project.endpoints.length} runtime endpoints</Badge>
      </div>
      {project.endpoints.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {project.endpoints.map((endpoint) => {
            const href =
              endpoint.kind === "mcp"
                ? `/mcp-endpoints/${endpoint.id}`
                : `/http-apis/${endpoint.id}`;
            const Icon = endpoint.kind === "mcp" ? TerminalSquare : Globe2;
            return (
              <Link
                href={href}
                className="panel flex gap-3 p-5 hover:border-primary/30"
                key={endpoint.id}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon size={18} />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold">{endpoint.name}</h2>
                    <Badge>
                      {endpoint.kind === "mcp" ? "MCP Endpoint" : "HTTP API"}
                    </Badge>
                    <Badge>{endpoint.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {endpoint.environment.name} · {endpoint._count.functions} Functions
                    ·{" "}
                    {endpoint.kind === "mcp"
                      ? `${endpoint._count.mcpToolBindings} tools`
                      : `${endpoint._count.httpRouteBindings} routes`}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {endpoint.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<FolderKanban />}
          title="No runtime endpoints"
          description={
            selected
              ? "Create an MCP Endpoint or HTTP API."
              : "Select this Project before creating an endpoint."
          }
        />
      )}
    </AppShell>
  );
}
