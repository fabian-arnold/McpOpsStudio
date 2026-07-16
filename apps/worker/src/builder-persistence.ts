import { prisma } from "@mcpops/db";
import type { ExtendedDeploymentSnapshot } from "./builder-validation.js";

type StoreDeploymentArtifactInput = {
  deploymentId: string;
  projectDeploymentId: string | null;
  activeDeploymentId: string | null;
  endpointId: string;
  projectId: string;
  environmentId: string;
  actorId?: string;
  deploymentVersion: number;
  snapshot: ExtendedDeploymentSnapshot;
  checksum: string;
};

export async function storeDeploymentArtifact(
  input: StoreDeploymentArtifactInput,
): Promise<boolean> {
  await prisma.$transaction(async (tx) => {
    if (input.projectDeploymentId) {
      await tx.deployment.update({
        where: { id: input.deploymentId },
        data: {
          snapshot: input.snapshot as never,
          checksum: input.checksum,
          status: "deploying",
        },
      });
      await tx.deploymentLog.create({
        data: {
          deploymentId: input.deploymentId,
          level: "info",
          message: `Endpoint artifact ${input.deploymentVersion} built for project deployment`,
          metadata: { checksum: input.checksum },
        },
      });
      return;
    }
    if (input.activeDeploymentId)
      await tx.deployment.update({
        where: { id: input.activeDeploymentId },
        data: { status: "rolled_back" },
      });
    await tx.deployment.update({
      where: { id: input.deploymentId },
      data: {
        snapshot: input.snapshot as never,
        checksum: input.checksum,
        status: "active",
        completedAt: new Date(),
      },
    });
    await tx.runtimeEndpoint.update({
      where: { id: input.endpointId },
      data: { activeDeploymentId: input.deploymentId, status: "deployed" },
    });
    await tx.deploymentLog.create({
      data: {
        deploymentId: input.deploymentId,
        level: "info",
        message: `Deployment ${input.deploymentVersion} activated`,
        metadata: { checksum: input.checksum },
      },
    });
    await tx.auditEvent.create({
      data: {
        projectId: input.projectId,
        environmentId: input.environmentId,
        endpointId: input.endpointId,
        actorType: input.actorId ? "user" : "system",
        actorId: input.actorId,
        action: "deployment.activated",
        targetType: "deployment",
        targetId: input.deploymentId,
        metadata: { version: input.deploymentVersion, checksum: input.checksum },
      },
    });
  });
  return !input.projectDeploymentId;
}
