"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  Code2,
  Command,
  FileJson2,
  LayoutDashboard,
  PanelsTopLeft,
  Library,
  FolderKanban,
  Github,
  KeyRound,
  LockKeyhole,
  LogOut,
  Menu,
  Moon,
  ServerCog,
  Settings,
  SlidersHorizontal,
  ShieldCheck,
  Sun,
  TerminalSquare,
  Network,
  Rocket,
  Scale,
  ScrollText,
  Users,
  X,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/cn";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useToast } from "@/components/providers";
import { NotificationCenter } from "@/components/notification-center";
import { roleAllows } from "@/lib/session";
import type { EnvironmentSummary, ProjectSummary, SessionIdentity } from "@/lib/types";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: string[];
};

const projectNav: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/functions", label: "Functions", icon: Code2 },
  { href: "/map", label: "Endpoint Map", icon: Network },
  { href: "/endpoints", label: "Endpoints", icon: FileJson2 },
  { href: "/mcp-endpoints", label: "MCP Endpoints", icon: TerminalSquare },
  { href: "/http-apis", label: "HTTP APIs", icon: ServerCog },
  { href: "/libraries", label: "Libraries", icon: Library },
  { href: "/auth-policies", label: "Authentication", icon: KeyRound },
  { href: "/secrets", label: "Secrets", icon: LockKeyhole },
  { href: "/executions", label: "Executions", icon: Activity },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/deployments", label: "Deployments", icon: Boxes },
  {
    href: "/project-settings",
    label: "Project settings",
    icon: SlidersHorizontal,
  },
];
const globalNav: NavItem[] = [
  {
    href: "/overview",
    label: "Overview",
    icon: PanelsTopLeft,
    roles: ["owner", "admin"],
  },
];
const administrationNav: NavItem[] = [
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/users", label: "Users", icon: Users },
  { href: "/audit", label: "Audit log", icon: ShieldCheck },
];

type DevelopmentStatus = {
  hasPendingChanges: boolean;
  hasPendingRelease: boolean;
  hasDeployableEndpoints: boolean;
  activeDeployment: {
    id: string;
    version: number;
    completedAt?: string | null;
  } | null;
  productionDeployment: {
    id: string;
    version: number | null;
    completedAt?: string | null;
  } | null;
  inProgressDeployment: {
    id: string;
    version: number;
    status: string;
    createdAt: string;
  } | null;
  latestDraftChange: { action: string; createdAt: string } | null;
};

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/15">
        <Command size={17} strokeWidth={2.3} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">MCP Ops Studio</span>
    </Link>
  );
}

function NavList({
  items,
  pathname,
  onNavigate,
  role,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
  role?: string | undefined;
}) {
  return (
    <div className="space-y-1">
      {items
        .filter((item) => !item.roles || (role && item.roles.includes(role)))
        .map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              {...(onNavigate ? { onClick: onNavigate } : {})}
              key={item.href}
              href={item.href}
              className={cn(
                "flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon key={`${item.href}:icon`} size={16} />
              <span key={`${item.href}:label`}>{item.label}</span>
              {active && (
                <span
                  key={`${item.href}:active`}
                  className="ml-auto size-1 rounded-full bg-primary"
                />
              )}
            </Link>
          );
        })}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [identity, setIdentity] = useState<SessionIdentity["user"]>();
  const [projects, setProjects] = useState<ProjectSummary[]>();
  const [projectsUnavailable, setProjectsUnavailable] = useState(false);
  const [projectSwitching, setProjectSwitching] = useState(false);
  const [projectSwitchError, setProjectSwitchError] = useState<string>();
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>();
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [environmentsUnavailable, setEnvironmentsUnavailable] = useState(false);
  const [developmentStatus, setDevelopmentStatus] = useState<DevelopmentStatus>();
  const [deploymentBusy, setDeploymentBusy] = useState(false);
  const toast = useToast();
  const refreshProjects = useCallback(async () => {
    try {
      const loadedProjects = await api<ProjectSummary[]>("/api/projects");
      setProjects(loadedProjects);
      setProjectsUnavailable(false);
    } catch {
      setProjects([]);
      setProjectsUnavailable(true);
    }
  }, []);
  const refreshDevelopmentStatus = useCallback(async () => {
    try {
      setDevelopmentStatus(await api<DevelopmentStatus>("/api/deployments/status"));
    } catch {
      setDevelopmentStatus(undefined);
    }
  }, []);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  useEffect(() => {
    void refreshDevelopmentStatus();
    const timer = window.setInterval(() => void refreshDevelopmentStatus(), 3_000);
    return () => window.clearInterval(timer);
  }, [refreshDevelopmentStatus]);
  useEffect(() => {
    let active = true;
    api<SessionIdentity>("/api/auth/me")
      .then((session) => {
        if (!active) return;
        if (session.user.mustChangePassword) {
          router.replace("/change-password");
          return;
        }
        setIdentity(session.user);
        setSessionUnavailable(false);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          router.replace("/login");
          return;
        }
        setSessionUnavailable(true);
      });
    api<EnvironmentSummary[]>("/api/environments")
      .then((loadedEnvironments) => {
        if (!active) return;
        setEnvironments(loadedEnvironments);
        setEnvironmentsUnavailable(false);
      })
      .catch(() => {
        if (!active) return;
        setEnvironments([]);
        setEnvironmentsUnavailable(true);
      });
    void refreshProjects();
    return () => {
      active = false;
    };
  }, [refreshProjects, router]);
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("mcpops-theme", next ? "dark" : "light");
  }
  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }
  async function selectProject(projectId: string) {
    if (!projectId || projectId === identity?.project.id || projectSwitching) return;
    setProjectSwitchError(undefined);
    setProjectSwitching(true);
    try {
      await api(`/api/projects/${projectId}/select`, {
        method: "POST",
        body: "{}",
      });
      window.location.assign("/");
    } catch (error) {
      setProjectSwitchError(errorMessage(error));
      setProjectSwitching(false);
    }
  }
  async function deployDevelopment() {
    if (
      deploymentBusy ||
      developmentStatus?.inProgressDeployment ||
      !developmentStatus?.hasPendingChanges
    )
      return;
    setDeploymentBusy(true);
    try {
      const deployment = await api<{ id: string; version: number }>(
        "/api/deployments",
        { method: "POST", body: "{}" },
      );
      toast({
        title: `Development v${deployment.version} queued`,
        description: "Current Project changes are being built together.",
        tone: "success",
      });
      await refreshDevelopmentStatus();
    } catch (error) {
      toast({
        title: "Development deployment failed",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setDeploymentBusy(false);
    }
  }
  const activeProjects =
    projects?.filter((project) => project.status === "active") ?? [];
  const displayName = identity?.name ?? identity?.email.split("@")[0];
  const initials =
    (displayName ?? "?")
      .split(/[._\s-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";
  const environmentLabel = environmentsUnavailable
    ? "Environments unavailable"
    : environments === undefined
      ? "Loading environments…"
      : environments.length === 0
        ? "No environments"
        : environments.length === 1
          ? environments[0]!.name
          : `All environments (${environments.length})`;
  const sidebar = (
    <>
      <div className="flex h-16 items-center px-5">
        <Brand />
      </div>
      <div className="px-3">
        <DropdownMenu.Root
          onOpenChange={(open) => {
            if (open) void refreshProjects();
          }}
        >
          <DropdownMenu.Trigger
            aria-label="Select project"
            disabled={
              projectSwitching ||
              !identity ||
              projects === undefined ||
              projectsUnavailable
            }
            className="flex w-full items-center gap-3 rounded-lg border bg-card p-2 text-left shadow-sm transition hover:border-primary/30 hover:bg-muted/30 disabled:cursor-default disabled:opacity-70"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-gradient-to-br from-orange-400 to-red-500 text-[11px] font-bold text-white">
              {identity ? identity.project.name.slice(0, 2).toUpperCase() : "—"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">
                {projectSwitching
                  ? "Switching project…"
                  : (identity?.project.name ??
                    (sessionUnavailable ? "Project unavailable" : "Loading project…"))}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {projectsUnavailable
                  ? "Projects unavailable"
                  : (identity?.project.slug ??
                    (identity ? "Current project" : "Session context"))}
              </span>
            </span>
            <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={8}
              className="z-50 w-56 rounded-xl border bg-card p-1.5 shadow-panel"
            >
              <p className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">
                Switch project
              </p>
              {activeProjects.map((project) => {
                const selected = project.id === identity?.project.id;
                return (
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs outline-none hover:bg-muted data-[disabled]:cursor-default data-[disabled]:opacity-70"
                    disabled={selected}
                    key={project.id}
                    onSelect={() => void selectProject(project.id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{project.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {project.slug}
                      </span>
                    </span>
                    {selected && <Check size={14} className="text-primary" />}
                  </DropdownMenu.Item>
                );
              })}
              {activeProjects.length === 0 && (
                <p className="px-2.5 py-3 text-xs text-muted-foreground">
                  No active projects
                </p>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {projectSwitchError && (
          <p className="mt-1.5 px-2 text-[10px] leading-4 text-red-500" role="alert">
            {projectSwitchError}
          </p>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-5">
        {roleAllows(identity?.role, ["owner", "admin"]) && (
          <div className="mb-6">
            <NavList
              items={globalNav}
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
              role={identity?.role}
            />
          </div>
        )}
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">
          Project
        </p>
        <NavList
          items={projectNav}
          pathname={pathname}
          onNavigate={() => setMobileOpen(false)}
          role={identity?.role}
        />
        <p className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">
          Administration
        </p>
        <NavList
          items={administrationNav}
          pathname={pathname}
          onNavigate={() => setMobileOpen(false)}
          role={identity?.role}
        />
      </nav>
      <div className="border-t p-3">
        <a
          href="https://github.com/fabian-arnold/McpOpsStudio"
          target="_blank"
          rel="noreferrer"
          className="flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Github size={16} />
          Source code
        </a>
        <a
          href="/legal"
          className="flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Scale size={16} />
          Legal notices
        </a>
        <a
          href="/docs"
          className="flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <BookOpen size={16} />
          Documentation
        </a>
        <a
          href="/settings"
          className="flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Settings size={16} />
          Platform settings
        </a>
      </div>
    </>
  );
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r bg-card/80 backdrop-blur-xl lg:flex">
        {sidebar}
      </aside>
      {mobileOpen && (
        <>
          <button
            aria-label="Close navigation"
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r bg-card lg:hidden">
            <button
              className="absolute right-3 top-4 p-2"
              onClick={() => setMobileOpen(false)}
            >
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </>
      )}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-16 items-center border-b bg-background/85 px-4 backdrop-blur-xl sm:px-6">
          <button
            className="mr-3 p-2 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={19} />
          </button>
          <div className="hidden items-center gap-2 sm:flex">
            <button
              disabled
              aria-label="Environment scope"
              title="Environment switching is not supported; this view uses its API-provided scope"
              className="flex h-9 min-w-40 items-center gap-2 rounded-lg border bg-card px-3 text-xs disabled:cursor-default"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  environments?.length ? "bg-emerald-500" : "bg-slate-400",
                )}
              />
              <span className="flex-1 text-left font-medium">{environmentLabel}</span>
              <ShieldCheck size={13} className="text-muted-foreground" />
            </button>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {developmentStatus && (
              <>
                <button
                  onClick={() => void deployDevelopment()}
                  disabled={
                    deploymentBusy ||
                    Boolean(developmentStatus.inProgressDeployment) ||
                    !developmentStatus.hasPendingChanges ||
                    !roleAllows(identity?.role, [
                      "owner",
                      "admin",
                      "developer",
                      "operator",
                    ])
                  }
                  title={
                    developmentStatus.inProgressDeployment
                      ? `Development v${developmentStatus.inProgressDeployment.version} is deploying`
                      : developmentStatus.hasPendingChanges
                        ? "Deploy all pending Project changes to Development"
                        : developmentStatus.activeDeployment
                          ? `Development v${developmentStatus.activeDeployment.version} is up to date`
                          : "No Development deployment is available"
                  }
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition disabled:cursor-default",
                    developmentStatus.inProgressDeployment
                      ? "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                      : developmentStatus.hasPendingChanges
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 disabled:opacity-60 dark:text-amber-300"
                        : "bg-card text-muted-foreground",
                  )}
                >
                  <Rocket
                    size={14}
                    className={
                      developmentStatus.inProgressDeployment || deploymentBusy
                        ? "animate-pulse"
                        : undefined
                    }
                  />
                  <span className="hidden md:inline">
                    {developmentStatus.inProgressDeployment
                      ? `Deploying v${developmentStatus.inProgressDeployment.version}`
                      : developmentStatus.hasPendingChanges
                        ? "Undeployed changes"
                        : developmentStatus.activeDeployment
                          ? `Development v${developmentStatus.activeDeployment.version}`
                          : "Development"}
                  </span>
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      developmentStatus.inProgressDeployment
                        ? "bg-blue-500"
                        : developmentStatus.hasPendingChanges
                          ? "bg-amber-500"
                          : "bg-emerald-500",
                    )}
                  />
                </button>
                <Link
                  href="/deployments"
                  title={
                    developmentStatus.hasPendingRelease
                      ? developmentStatus.activeDeployment
                        ? `Development v${developmentStatus.activeDeployment.version} is ready to release to Production`
                        : "Production release is pending"
                      : developmentStatus.productionDeployment?.version
                        ? `Production is on v${developmentStatus.productionDeployment.version}`
                        : "Production has no release"
                  }
                  aria-label="Production release status"
                  className={cn(
                    "mr-1 flex h-9 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium transition hover:bg-muted",
                    developmentStatus.hasPendingRelease
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : "bg-card text-muted-foreground",
                  )}
                >
                  <span className="hidden lg:inline">
                    {developmentStatus.hasPendingRelease
                      ? "Release"
                      : developmentStatus.productionDeployment?.version
                        ? `Prod v${developmentStatus.productionDeployment.version}`
                        : "Prod"}
                  </span>
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      developmentStatus.hasPendingRelease
                        ? "bg-amber-500"
                        : developmentStatus.productionDeployment
                          ? "bg-emerald-500"
                          : "bg-slate-400",
                    )}
                  />
                </Link>
              </>
            )}
            <NotificationCenter projectId={identity?.project.id} />
            <button
              onClick={toggleTheme}
              className="grid size-9 place-items-center rounded-lg hover:bg-muted"
              aria-label="Toggle theme"
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="ml-1 flex items-center gap-2 rounded-lg p-1.5 hover:bg-muted">
                <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-[10px] font-bold text-white">
                  {initials}
                </span>
                <ChevronDown size={13} className="text-muted-foreground" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  className="z-50 w-56 rounded-xl border bg-card p-1.5 shadow-panel"
                >
                  <div className="px-2.5 py-2">
                    <p className="text-xs font-semibold">
                      {displayName ??
                        (sessionUnavailable
                          ? "Session unavailable"
                          : "Loading identity…")}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {identity?.email ?? "Authenticated identity not reported"}
                    </p>
                  </div>
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs outline-none hover:bg-muted"
                    onSelect={logout}
                  >
                    <LogOut size={14} />
                    Sign out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>
        <main className="w-full p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
