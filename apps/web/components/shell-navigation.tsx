"use client";

import Link from "next/link";
import {
  Activity,
  CalendarClock,
  Boxes,
  Code2,
  Command,
  Database,
  LayoutDashboard,
  PanelsTopLeft,
  Library,
  FolderKanban,
  KeyRound,
  LockKeyhole,
  ServerCog,
  SlidersHorizontal,
  ShieldCheck,
  TerminalSquare,
  Network,
  ScrollText,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: string[];
};

export const projectNav: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/functions", label: "Functions", icon: Code2 },
  { href: "/schedules", label: "Schedules", icon: CalendarClock },
  { href: "/map", label: "Endpoint Map", icon: Network },
  { href: "/endpoints", label: "Endpoints", icon: ServerCog },
  { href: "/libraries", label: "Libraries", icon: Library },
  { href: "/storage", label: "Storage", icon: Database },
  { href: "/auth-policies", label: "Authentication", icon: KeyRound },
  { href: "/secrets", label: "Secrets", icon: LockKeyhole },
  { href: "/executions", label: "Executions", icon: Activity },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/deployments", label: "Deployments", icon: Boxes },
  { href: "/mcp-access", label: "IDE access", icon: TerminalSquare },
  {
    href: "/project-settings",
    label: "Project settings",
    icon: SlidersHorizontal,
  },
];
export const globalNav: NavItem[] = [
  {
    href: "/overview",
    label: "Overview",
    icon: PanelsTopLeft,
    roles: ["owner", "admin"],
  },
];
export const administrationNav: NavItem[] = [
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/users", label: "Users", icon: Users },
  { href: "/audit", label: "Audit log", icon: ShieldCheck },
];

export type DevelopmentStatus = {
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

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/15">
        <Command size={17} strokeWidth={2.3} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">MCP Ops Studio</span>
    </Link>
  );
}

export function NavList({
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
