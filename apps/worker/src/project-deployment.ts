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
};

export function projectDeploymentReadiness(
  statuses: string[],
): "failed" | "waiting" | "ready" {
  if (statuses.includes("failed")) return "failed";
  if (statuses.some((status) => ["queued", "building"].includes(status)))
    return "waiting";
  return "ready";
}

export async function finalizeProjectDeployment(
  projectDeploymentId: string,
): Promise<void> {
  const projectDeployment = await prisma.projectDeployment.findUnique({
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
      environment: { select: { activeProjectDeploymentId: true } },
    },
  });
  if (!projectDeployment || projectDeployment.completedAt) return;
  const readiness = projectDeploymentReadiness(
    projectDeployment.endpointDeployments.map((item) => item.status),
  );
  if (readiness === "failed") {
    await prisma.projectDeployment.update({
      where: { id: projectDeploymentId },
      data: { status: "failed", completedAt: new Date() },
    });
    return;
  }
  if (readiness === "waiting") return;

  const snapshot: ProjectDeploymentSnapshot = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
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
  };
  const checksum = createHash("sha256")
    .update(canonicalJson(snapshot))
    .digest("hex");
  await prisma.$transaction(async (tx) => {
    const previousId = projectDeployment.environment.activeProjectDeploymentId;
    if (previousId && previousId !== projectDeploymentId)
      await tx.projectDeployment.update({
        where: { id: previousId },
        data: { status: "rolled_back" },
      });
    await tx.projectDeployment.update({
      where: { id: projectDeploymentId },
      data: {
        status: "active",
        snapshot: snapshot as never,
        checksum,
        completedAt: new Date(),
      },
    });
    await tx.environment.update({
      where: { id: projectDeployment.environmentId },
      data: { activeProjectDeploymentId: projectDeploymentId },
    });
    for (const deployment of projectDeployment.endpointDeployments) {
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
        data: { status: "active", completedAt: new Date() },
      });
      await tx.runtimeEndpoint.update({
        where: { id: deployment.endpointId },
        data: { activeDeploymentId: deployment.id, status: "deployed" },
      });
    }
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
  });
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
