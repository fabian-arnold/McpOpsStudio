"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Bell, CheckCheck, Info, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

type NotificationItem = {
  id: string;
  kind: "deployment" | "audit";
  severity: "error" | "warning" | "info";
  title: string;
  message?: string;
  endpointName?: string;
  functions?: Array<{
    id: string;
    name: string;
    slug?: string;
    version?: number;
    inferred?: boolean;
  }>;
  href?: string;
  createdAt?: string | null;
};

type NotificationResponse = {
  items: NotificationItem[];
};

export function NotificationCenter({ projectId }: { projectId: string | undefined }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(true);
  const storageKey = projectId ? `mcpops-notifications-seen:${projectId}` : undefined;

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const response = await api<NotificationResponse>("/api/notifications");
      setItems(response.items);
      setAvailable(true);
    } catch {
      setAvailable(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      setSeen(JSON.parse(localStorage.getItem(storageKey) ?? "[]") as string[]);
    } catch {
      setSeen([]);
    }
  }, [storageKey]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const unread = useMemo(
    () => items.filter((item) => !seen.includes(item.id)).length,
    [items, seen],
  );

  function markAllRead() {
    const ids = items.map((item) => item.id);
    setSeen(ids);
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(ids));
  }

  function showPanel() {
    setOpen(true);
    markAllRead();
    void refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={showPanel}
        disabled={!available}
        className="relative grid size-9 place-items-center rounded-lg hover:bg-muted disabled:opacity-50"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        title={available ? "Notifications" : "Notifications unavailable"}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[80]" role="presentation">
            <button
              className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
              onClick={() => setOpen(false)}
              aria-label="Close notifications"
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-label="Notifications"
              className="absolute inset-y-0 right-0 flex w-[min(430px,100vw)] flex-col border-l bg-card shadow-2xl"
            >
              <header className="flex h-16 shrink-0 items-center gap-3 border-b px-5">
                <Bell size={18} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold">Notifications</h2>
                  <p className="text-[10px] text-muted-foreground">
                    Project operations and deployment failures
                  </p>
                </div>
                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Mark all as read"
                    aria-label="Mark all notifications as read"
                  >
                    <CheckCheck size={15} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid size-8 place-items-center rounded-lg hover:bg-muted"
                  aria-label="Close notifications"
                >
                  <X size={16} />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {items.length ? (
                  <div className="divide-y">
                    {items.map((item) => {
                      const Icon = item.severity === "error" ? AlertTriangle : Info;
                      const content = (
                        <div className="flex gap-3 px-5 py-4">
                          <span
                            className={cn(
                              "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
                              item.severity === "error"
                                ? "bg-red-500/10 text-red-500"
                                : item.severity === "warning"
                                  ? "bg-amber-500/10 text-amber-500"
                                  : "bg-blue-500/10 text-blue-500",
                            )}
                          >
                            <Icon size={15} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold leading-5">
                              {item.title.replaceAll("_", " ")}
                            </p>
                            {item.endpointName && (
                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                Endpoint: {item.endpointName}
                              </p>
                            )}
                            {item.functions?.length ? (
                              <div className="mt-1 text-[11px] font-medium text-red-700 dark:text-red-300">
                                {item.functions.map((fn) => (
                                  <p key={fn.id}>
                                    {fn.inferred ? "Likely Function" : "Function"}:{" "}
                                    {fn.name}
                                    {fn.slug ? ` (${fn.slug})` : ""}
                                    {fn.version ? ` · v${fn.version}` : ""}
                                  </p>
                                ))}
                              </div>
                            ) : null}
                            {item.message && (
                              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-red-500/15 bg-red-500/5 p-2.5 font-mono text-[10px] leading-4 text-red-800 dark:text-red-200">
                                {item.message}
                              </pre>
                            )}
                            <p className="mt-2 text-[10px] text-muted-foreground">
                              {item.createdAt
                                ? new Date(item.createdAt).toLocaleString()
                                : "Time unavailable"}
                            </p>
                          </div>
                        </div>
                      );
                      return item.href ? (
                        <Link
                          key={item.id}
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="block transition hover:bg-muted/50"
                        >
                          {content}
                        </Link>
                      ) : (
                        <div key={item.id}>{content}</div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid h-full min-h-80 place-items-center p-8 text-center">
                    <div>
                      <span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-500/10 text-emerald-500">
                        <CheckCheck size={20} />
                      </span>
                      <p className="mt-4 text-sm font-semibold">No notifications</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Deployment failures and important project activity will appear
                        here.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}
