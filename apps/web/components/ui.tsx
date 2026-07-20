"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, LoaderCircle, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/cn";

export function Button({
  className,
  variant = "primary",
  size = "default",
  loading,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "default" | "sm" | "icon";
  loading?: boolean;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" &&
          "bg-primary text-primary-foreground hover:brightness-110",
        variant === "secondary" && "border bg-card hover:bg-muted",
        variant === "ghost" && "hover:bg-muted",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-500",
        size === "default" && "h-9 px-3.5",
        size === "sm" && "h-8 px-3 text-xs",
        size === "icon" && "size-9",
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <LoaderCircle size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "primary" | "info";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "success" &&
          "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        tone === "warning" &&
          "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        tone === "danger" &&
          "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400",
        tone === "primary" && "border-primary/20 bg-primary/10 text-primary",
        tone === "info" &&
          "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  const tone = ["active", "deployed", "success", "healthy"].includes(status)
    ? "bg-emerald-500"
    : ["error", "failed", "denied"].includes(status)
      ? "bg-red-500"
      : ["building", "deploying", "queued", "running"].includes(status)
        ? "bg-amber-500"
        : "bg-slate-400";
  return <span className={cn("size-1.5 rounded-full", tone)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
      <div className="mb-4 rounded-xl bg-muted p-3 text-muted-foreground">{icon}</div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Dialog({
  trigger,
  title,
  description,
  children,
  open,
  onOpenChange,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <DialogPrimitive.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-5 shadow-2xl">
          <div className="pr-8">
            <DialogPrimitive.Title className="font-semibold">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="absolute right-4 top-4 rounded-md p-1 hover:bg-muted"
            aria-label="Close"
          >
            <X size={16} />
          </DialogPrimitive.Close>
          <div className="mt-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function LoadError({
  title = "Unable to load this view",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/[.035] p-8 text-center"
    >
      <span className="grid size-11 place-items-center rounded-xl bg-red-500/10 text-red-500">
        <AlertTriangle size={20} />
      </span>
      <h2 className="mt-4 text-sm font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{message}</p>
      <Button className="mt-5" variant="secondary" onClick={onRetry}>
        <RefreshCw size={13} />
        Retry
      </Button>
    </div>
  );
}

export function UnavailableValue({ label = "Not reported" }: { label?: string }) {
  return (
    <span
      className="text-muted-foreground"
      title="The control-plane API did not report this value"
    >
      {label}
    </span>
  );
}
