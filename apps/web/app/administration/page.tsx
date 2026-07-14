"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, FolderKanban, ShieldCheck, Users } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Badge, LoadError, PageHeader, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type {
  AuditEvent,
  ProjectSummary,
  SessionIdentity,
  UserSummary,
} from "@/lib/types";

export default function AdministrationPage() {
  const [data, setData] = useState<{
    projects: ProjectSummary[];
    users: UserSummary[];
    audit: AuditEvent[];
  }>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    setError(undefined);
    api<SessionIdentity>("/api/auth/me")
      .then(async (identity) => {
        const [projects, users, audit] = await Promise.all([
          api<ProjectSummary[]>("/api/projects"),
          identity.user.role === "owner"
            ? api<UserSummary[]>("/api/users")
            : Promise.resolve([]),
          api<{ items: AuditEvent[] }>("/api/audit-events?limit=8"),
        ]);
        setData({ projects, users, audit: audit.items });
      })
      .catch((reason) => setError(errorMessage(reason)));
  }, []);
  useEffect(load, [load]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Installation"
        title="Administration"
        description="Manage installation-wide projects and users, and review immutable administrative activity."
      />
      {error ? (
        <LoadError title="Administration unavailable" message={error} onRetry={load} />
      ) : !data ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <AdminPanel
            href="/projects"
            icon={<FolderKanban size={17} />}
            title="Projects"
            count={data.projects.length}
            description="Operational resource boundaries and project lifecycle."
          >
            {data.projects.slice(0, 5).map((project) => (
              <div className="flex items-center gap-2 py-2" key={project.id}>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {project.name}
                </span>
                <Badge tone={project.status === "active" ? "success" : "neutral"}>
                  {project.status}
                </Badge>
              </div>
            ))}
          </AdminPanel>
          <AdminPanel
            href="/users"
            icon={<Users size={17} />}
            title="Users"
            count={data.users.length}
            description="Local accounts and installation-wide platform roles."
          >
            {data.users.slice(0, 5).map((user) => (
              <div className="flex items-center gap-2 py-2" key={user.id}>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {user.email}
                </span>
                <Badge tone={user.active ? "success" : "neutral"}>{user.role}</Badge>
              </div>
            ))}
          </AdminPanel>
          <AdminPanel
            href="/audit"
            icon={<ShieldCheck size={17} />}
            title="Audit log"
            count={data.audit.length}
            description="Immutable configuration, deployment, and security events."
          >
            {data.audit.slice(0, 5).map((event) => (
              <div className="py-2" key={event.id}>
                <p className="truncate text-xs font-medium">
                  {event.action.replaceAll(".", " ")}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </AdminPanel>
        </div>
      )}
    </AppShell>
  );
}

function AdminPanel({
  href,
  icon,
  title,
  count,
  description,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  count: number;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel flex min-h-72 flex-col p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            <Badge>{count}</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4 flex-1 divide-y">{children}</div>
      <Link
        href={href}
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
      >
        Manage {title.toLowerCase()} <ArrowRight size={12} />
      </Link>
    </section>
  );
}
