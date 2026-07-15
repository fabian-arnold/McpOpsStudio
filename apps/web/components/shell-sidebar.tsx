"use client";
import { BookOpen, Check, ChevronDown, Github, Settings, Scale } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { roleAllows } from "@/lib/session";
import type { ProjectSummary, SessionIdentity } from "@/lib/types";
import {
  Brand,
  type DevelopmentStatus,
  NavList,
  administrationNav,
  globalNav,
  projectNav,
} from "./shell-navigation";

const buildVersion = process.env.NEXT_PUBLIC_MCP_OPS_VERSION ?? "development";
const buildCommit = process.env.NEXT_PUBLIC_MCP_OPS_COMMIT_SHA ?? "unknown";
const shortBuildCommit =
  buildCommit === "unknown" ? buildCommit : buildCommit.slice(0, 12);

export function ShellSidebar({
  identity,
  pathname,
  projects,
  projectsUnavailable,
  sessionUnavailable,
  projectSwitchError,
  projectSwitching,
  refreshProjects,
  selectProject,
  setMobileOpen,
}: {
  identity?: SessionIdentity["user"];
  pathname: string;
  projects?: ProjectSummary[];
  projectsUnavailable: boolean;
  sessionUnavailable: boolean;
  projectSwitchError?: string;
  projectSwitching: boolean;
  refreshProjects: () => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  setMobileOpen: (open: boolean) => void;
  developmentStatus?: DevelopmentStatus;
}): React.ReactNode {
  const activeProjects =
    projects?.filter((project) => project.status === "active") ?? [];
  return (
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
        <div
          className="mt-2 border-t px-3 pt-3 text-[10px] leading-4 text-muted-foreground"
          title={`Version ${buildVersion} · Commit ${buildCommit}`}
        >
          <p>
            Version{" "}
            <span className="font-medium text-foreground/70">{buildVersion}</span>
          </p>
          <p>
            Commit <code className="text-foreground/70">{shortBuildCommit}</code>
          </p>
        </div>
      </div>
    </>
  );
}
