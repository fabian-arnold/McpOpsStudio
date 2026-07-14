import { type FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import { projectUpdateSchema } from "@mcpops/shared";
import { issueSession, requireRole } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";

export async function registerProjectAdminRoutes(app: FastifyInstance): Promise<void> {
  app.patch("/api/projects/:projectId", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { projectId } = request.params as { projectId: string };
    const input = parse(projectUpdateSchema, request.body);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Project not found",
          requestId: requestId(request),
        },
      });
    const updated = await prisma.project.update({
      where: { id: projectId },
      data: input,
    });
    await prisma.auditEvent.create({
      data: {
        projectId,
        actorType: "user",
        actorId: session.userId,
        action: "project.updated",
        targetType: "project",
        targetId: projectId,
        metadata: {
          name: updated.name,
          slug: updated.slug,
          fields: Object.keys(input),
        },
      },
    });
    return updated;
  });
  app.post("/api/projects/:projectId/select", async (request, reply) => {
    const session = sessionContext(request);
    const { projectId } = request.params as { projectId: string };
    const project = await prisma.project.findFirst({
      where: { id: projectId, status: "active" },
    });
    if (!project)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Active project not found",
          requestId: requestId(request),
        },
      });
    const csrfToken = issueSession(reply, {
      userId: session.userId,
      projectId,
      role: session.role,
      email: session.email,
      sessionVersion: session.sessionVersion,
    });
    return { project, csrfToken };
  });
  app.post("/api/projects/:projectId/archive", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { projectId } = request.params as { projectId: string };
    if (projectId === session.projectId)
      return reply.status(409).send({
        error: {
          code: "PROJECT_SELECTED",
          message: "Select another project before archiving this one",
          requestId: requestId(request),
        },
      });
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Project not found",
          requestId: requestId(request),
        },
      });
    await prisma.$transaction(async (tx) => {
      await tx.runtimeEndpoint.updateMany({
        where: { projectId },
        data: { status: "disabled" },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { status: "archived" },
      });
      await tx.auditEvent.create({
        data: {
          projectId,
          actorType: "user",
          actorId: session.userId,
          action: "project.archived",
          targetType: "project",
          targetId: projectId,
          metadata: { name: project.name, slug: project.slug },
        },
      });
    });
    return { ok: true, status: "archived" };
  });
  app.delete("/api/projects/:projectId", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { projectId } = request.params as { projectId: string };
    if (projectId === session.projectId)
      return reply.status(409).send({
        error: {
          code: "PROJECT_SELECTED",
          message: "Select another project before deleting this one",
          requestId: requestId(request),
        },
      });
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { _count: { select: { endpoints: true } } },
    });
    if (!project)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Project not found",
          requestId: requestId(request),
        },
      });
    if (project._count.endpoints > 0)
      return reply.status(409).send({
        error: {
          code: "PROJECT_NOT_EMPTY",
          message:
            "Archive the project or remove its runtime endpoints before deletion",
          requestId: requestId(request),
        },
      });
    await prisma.project.delete({ where: { id: projectId } });
    await prisma.auditEvent.create({
      data: {
        projectId: null,
        actorType: "user",
        actorId: session.userId,
        action: "project.deleted",
        targetType: "project",
        targetId: projectId,
        metadata: { name: project.name, slug: project.slug },
      },
    });
    return reply.status(204).send();
  });
}
