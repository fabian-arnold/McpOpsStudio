import { createHash } from "node:crypto";
import { prisma } from "@mcpops/db";

type EndpointArtifact = {
  endpointId: string;
  deploymentId: string;
  version: number;
  checksum: string;
  endpoint: { id: string; name: string; slug: string; kind: "mcp" | "http" };
  snapshot: unknown;
};

export type ProjectDeploymentSnapshot = {
  schemaVersion: 1;
  createdAt: string;
  projectId: string;
  environmentId: string;
  endpoints: EndpointArtifact[];
  schedule?: {
    scheduleDeploymentId: string;
    checksum: string;
    snapshot: unknown;
  };
};

export function projectDeploymentReadiness(
  statuses: string[],
): "failed" | "waiting" | "ready" {
  if (statuses.includes("failed")) return "failed";
  return statuses.length > 0 && statuses.every((status) => status === "deploying")
    ? "ready"
    : "waiting";
}

export async function finalizeProjectDeployment(
  projectDeploymentId: string,
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await finalizeTransaction(projectDeploymentId);
      return;
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === 3) throw error;
    }
  }
}

async function finalizeTransaction(projectDeploymentId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const projectDeployment = await tx.projectDeployment.findUnique({
        where: { id: projectDeploymentId },
        include: {
          endpointDeployments: {
            include: {
              endpoint: {
                select: { id: true, name: true, slug: true, kind: true },
              },
            },
            orderBy: { endpointId: "asc" },
          },
          scheduleDeployment: true,
        },
      });
      if (!projectDeployment || projectDeployment.completedAt) return;

      const readiness = projectDeploymentReadiness([
        ...projectDeployment.endpointDeployments.map((item) => item.status),
        ...(projectDeployment.scheduleDeployment
          ? [projectDeployment.scheduleDeployment.status]
          : []),
      ]);
      const completedAt = new Date();
      if (readiness === "failed") {
        await tx.projectDeployment.updateMany({
          where: { id: projectDeploymentId, completedAt: null },
          data: { status: "failed", completedAt },
        });
        return;
      }
      if (readiness === "waiting") return;

      const claim = await tx.projectDeployment.updateMany({
        where: {
          id: projectDeploymentId,
          completedAt: null,
          status: { in: ["queued", "building"] },
        },
        data: { status: "deploying" },
      });
      if (claim.count === 0) return;

      const snapshot = createProjectSnapshot(projectDeployment, completedAt);
      const checksum = createHash("sha256")
        .update(canonicalJson(snapshot))
        .digest("hex");
      await tx.projectDeployment.updateMany({
        where: {
          projectId: projectDeployment.projectId,
          environmentId: projectDeployment.environmentId,
          status: "active",
          id: { not: projectDeploymentId },
        },
        data: { status: "rolled_back" },
      });
      await tx.projectDeployment.update({
        where: { id: projectDeploymentId },
        data: {
          status: "active",
          snapshot: snapshot as never,
          checksum,
          completedAt,
        },
      });
      await tx.environment.update({
        where: { id: projectDeployment.environmentId },
        data: { activeProjectDeploymentId: projectDeploymentId },
      });
      for (const deployment of projectDeployment.endpointDeployments) {
        await activateEndpoint(tx, deployment, completedAt);
      }
      if (projectDeployment.scheduleDeployment)
        await tx.scheduleDeployment.update({
          where: { id: projectDeployment.scheduleDeployment.id },
          data: { status: "active", completedAt },
        });
      await tx.auditEvent.create({
        data: {
          projectId: projectDeployment.projectId,
          environmentId: projectDeployment.environmentId,
          actorType: "system",
          action: "project_deployment.activated",
          targetType: "project_deployment",
          targetId: projectDeploymentId,
          metadata: { version: projectDeployment.version, checksum },
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}

type FinalizationTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function activateEndpoint(
  tx: FinalizationTransaction,
  deployment: {
    id: string;
    endpointId: string;
  },
  completedAt: Date,
): Promise<void> {
  const endpoint = await tx.runtimeEndpoint.findUniqueOrThrow({
    where: { id: deployment.endpointId },
    select: { activeDeploymentId: true },
  });
  if (endpoint.activeDeploymentId)
    await tx.deployment.update({
      where: { id: endpoint.activeDeploymentId },
      data: { status: "rolled_back" },
    });
  await tx.deployment.update({
    where: { id: deployment.id },
    data: { status: "active", completedAt },
  });
  await tx.runtimeEndpoint.update({
    where: { id: deployment.endpointId },
    data: { activeDeploymentId: deployment.id, status: "deployed" },
  });
}

function createProjectSnapshot(
  projectDeployment: {
    projectId: string;
    environmentId: string;
    endpointDeployments: Array<{
      endpointId: string;
      id: string;
      version: number;
      checksum: string;
      endpoint: EndpointArtifact["endpoint"];
      snapshot: unknown;
    }>;
    scheduleDeployment?: {
      id: string;
      checksum: string;
      snapshot: unknown;
    } | null;
  },
  completedAt: Date,
): ProjectDeploymentSnapshot {
  return {
    schemaVersion: 1,
    createdAt: completedAt.toISOString(),
    projectId: projectDeployment.projectId,
    environmentId: projectDeployment.environmentId,
    endpoints: projectDeployment.endpointDeployments.map((item) => ({
      endpointId: item.endpointId,
      deploymentId: item.id,
      version: item.version,
      checksum: item.checksum,
      endpoint: item.endpoint,
      snapshot: item.snapshot,
    })),
    ...(projectDeployment.scheduleDeployment
      ? {
          schedule: {
            scheduleDeploymentId: projectDeployment.scheduleDeployment.id,
            checksum: projectDeployment.scheduleDeployment.checksum,
            snapshot: projectDeployment.scheduleDeployment.snapshot,
          },
        }
      : {}),
  };
}

function isTransactionConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
