"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Rocket, Send } from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  Button,
  EmptyState,
  LoadError,
  PageHeader,
  Skeleton,
  StatusDot,
} from "@/components/ui";
import { useToast } from "@/components/providers";
import { api, errorMessage } from "@/lib/api";

type ProjectDeployment = {
  id: string;
  version: number;
  status: "queued" | "building" | "deploying" | "active" | "failed" | "rolled_back";
  checksum: string;
  endpointCount: number;
  environment: { id: string; name: string; slug: string; baseUrl: string };
  sourceProjectDeployment?: { id: string; version: number };
  createdAt: string;
  completedAt?: string;
};

type DeploymentResponse = {
  items: ProjectDeployment[];
  nextCursor?: string;
};

export default function DeploymentsPage() {
  const toast = useToast();
  const [items, setItems] = useState<ProjectDeployment[]>();
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState<"deploy" | "release" | "rollback">();
  const load = useCallback(async () => {
    try {
      const response = await api<DeploymentResponse>("/api/deployments?limit=100");
      setItems(response.items);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);
  useEffect(() => void load(), [load]);
  const inProgress = items?.some((item) =>
    ["queued", "building", "deploying"].includes(item.status),
  );
  useEffect(() => {
    if (!inProgress) return;
    const timer = window.setInterval(() => void load(), 1500);
    return () => window.clearInterval(timer);
  }, [inProgress, load]);
  const development = useMemo(
    () => items?.filter((item) => item.environment.slug === "development") ?? [],
    [items],
  );
  const production = useMemo(
    () => items?.filter((item) => item.environment.slug === "production") ?? [],
    [items],
  );

  async function deployDevelopment() {
    setBusy("deploy");
    try {
      const deployment = await api<ProjectDeployment>("/api/deployments", {
        method: "POST",
        body: "{}",
      });
      toast({
        title: `Development v${deployment.version} queued`,
        description: "All project endpoints are being built from current development drafts.",
        tone: "success",
      });
      await load();
    } catch (error) {
      toast({ title: "Deployment failed", description: errorMessage(error), tone: "error" });
    } finally {
      setBusy(undefined);
    }
  }

  async function release(sourceProjectDeploymentId: string) {
    setBusy("release");
    try {
      const deployment = await api<ProjectDeployment>("/api/deployments/release", {
        method: "POST",
        body: JSON.stringify({ sourceProjectDeploymentId }),
      });
      toast({
        title: `Production v${deployment.version} released`,
        description: "Production now serves the immutable development snapshot.",
        tone: "success",
      });
      await load();
    } catch (error) {
      toast({ title: "Release failed", description: errorMessage(error), tone: "error" });
    } finally {
      setBusy(undefined);
    }
  }

  async function rollback(projectDeploymentId: string) {
    setBusy("rollback");
    try {
      await api(`/api/deployments/${projectDeploymentId}/rollback`, {
        method: "POST",
        body: "{}",
      });
      toast({ title: "Deployment restored", description: "The selected immutable project version is active again.", tone: "success" });
      await load();
    } catch (error) {
      toast({ title: "Rollback failed", description: errorMessage(error), tone: "error" });
    } finally {
      setBusy(undefined);
    }
  }

  if (loadError)
    return (
      <AppShell>
        <PageHeader eyebrow="Delivery" title="Project deployments" description="Deploy development drafts together, then release an immutable version to production." />
        <LoadError title="Unable to load deployments" message={loadError} onRetry={() => void load()} />
      </AppShell>
    );
  return (
    <AppShell>
      <PageHeader
        eyebrow="Delivery"
        title="Project deployments"
        description="Saving updates development. Deploy all project endpoints together, then release that immutable version to production."
        actions={
          <Button loading={busy === "deploy"} onClick={() => void deployDevelopment()}>
            <Rocket size={14} /> Deploy development
          </Button>
        }
      />
      {!items ? (
        <Skeleton className="h-80" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <DeploymentLane
            title="Development"
            description="Current project drafts are built here. A successful deployment is eligible for production release."
            items={development}
            action={(item) => (
              <div className="flex gap-2">
                {["active", "rolled_back"].includes(item.status) && (
                  <Button size="sm" variant="secondary" loading={busy === "release"} onClick={() => void release(item.id)}>
                    <Send size={13} /> Release
                  </Button>
                )}
                {item.status === "rolled_back" && (
                  <Button size="sm" variant="secondary" loading={busy === "rollback"} onClick={() => void rollback(item.id)}>Rollback</Button>
                )}
              </div>
            )}
          />
          <DeploymentLane
            title="Production"
            description="Production versions are promoted from completed development snapshots without rebuilding drafts."
            items={production}
            action={(item) => item.status === "rolled_back" ? (
              <Button size="sm" variant="secondary" loading={busy === "rollback"} onClick={() => void rollback(item.id)}>Rollback</Button>
            ) : null}
          />
        </div>
      )}
    </AppShell>
  );
}

function DeploymentLane({
  title,
  description,
  items,
  action,
}: {
  title: string;
  description: string;
  items: ProjectDeployment[];
  action?: (item: ProjectDeployment) => React.ReactNode;
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b p-5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {!items.length ? (
        <EmptyState icon={<Boxes />} title={`No ${title.toLowerCase()} deployments`} description="Project deployment history will appear here." />
      ) : (
        <div className="divide-y">
          {items.map((item) => (
            <article className="flex flex-wrap items-center gap-4 p-4" key={item.id}>
              <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Boxes size={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Version {item.version}</p>
                  <Badge tone={item.status === "active" ? "success" : item.status === "failed" ? "danger" : "neutral"}>
                    <StatusDot status={item.status} /> {item.status.replaceAll("_", " ")}
                  </Badge>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {item.endpointCount} endpoints · {new Date(item.createdAt).toLocaleString()}
                  {item.sourceProjectDeployment ? ` · from development v${item.sourceProjectDeployment.version}` : ""}
                </p>
                {item.checksum && <code className="mt-1 block truncate text-[9px] text-muted-foreground">sha256:{item.checksum}</code>}
              </div>
              {action?.(item)}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
