import { prisma } from "@mcpops/db";

export async function activeRememberedPlatformMcpProjectId(
  userId: string,
  projectId: string | undefined,
): Promise<string | undefined> {
  if (!projectId) return;
  const project = await prisma.project.findFirst({
    where: { id: projectId, status: "active" },
    select: { id: true },
  });
  if (project) return project.id;
  await prisma.user.updateMany({
    where: { id: userId, lastPlatformMcpProjectId: projectId },
    data: { lastPlatformMcpProjectId: null },
  });
}

export async function rememberPlatformMcpProject(
  userId: string,
  projectId: string,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { lastPlatformMcpProjectId: projectId },
  });
}
