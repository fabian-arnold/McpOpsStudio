import { type FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import { projectDeleteSchema, projectSettingsUpdateSchema } from "@mcpops/shared";
import { issueSession, requireRole } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";

export async function registerProjectSettingsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/project-settings", async (request, reply) => {
    const session = sessionContext(request);
    const project = await prisma.project.findUnique({
      where: { id: session.projectId },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        status: true,
        updatedAt: true,
        environments: {
          where: { slug: { in: ["development", "production"] } },
          select: {
            id: true,
            slug: true,
            capturePayloads: true,
            logLevel: true,
            logRetentionDays: true,
            logRetentionMaxEntries: true,
            logRetentionMaxBytes: true,
          },
        },
      },
    });
    if (!project)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Selected project not found",
          requestId: requestId(request),
        },
      });
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      status: project.status,
      updatedAt: project.updatedAt,
      captureDevelopmentPayloads:
        project.environments.find((environment) => environment.slug === "development")
          ?.capturePayloads ?? false,
      logging: {
        development: environmentLogSettings(project.environments, "development", {
          level: "debug",
          retentionDays: 7,
          retentionMaxEntries: 50_000,
          retentionMaxBytes: 50 * 1024 * 1024,
        }),
        production: environmentLogSettings(project.environments, "production", {
          level: "info",
          retentionDays: 30,
          retentionMaxEntries: 200_000,
          retentionMaxBytes: 250 * 1024 * 1024,
        }),
      },
    };
  });

  function environmentLogSettings(
    environments: Array<{
      slug: string;
      logLevel: string;
      logRetentionDays: number;
      logRetentionMaxEntries: number;
      logRetentionMaxBytes: number;
    }>,
    slug: "development" | "production",
    fallback: {
      level: "debug" | "info";
      retentionDays: number;
      retentionMaxEntries: number;
      retentionMaxBytes: number;
    },
  ) {
    const environment = environments.find((candidate) => candidate.slug === slug);
    return environment
      ? {
          level: environment.logLevel,
          retentionDays: environment.logRetentionDays,
          retentionMaxEntries: environment.logRetentionMaxEntries,
          retentionMaxBytes: environment.logRetentionMaxBytes,
        }
      : fallback;
  }

  app.patch("/api/project-settings", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const input = parse(projectSettingsUpdateSchema, request.body);
    const { captureDevelopmentPayloads, logging, ...projectInput } = input;
    const development =
      captureDevelopmentPayloads === undefined
        ? null
        : await prisma.environment.findFirst({
            where: { projectId: session.projectId, slug: "development" },
            select: { id: true },
          });
    if (captureDevelopmentPayloads !== undefined && !development)
      return reply.status(409).send({
        error: {
          code: "DEVELOPMENT_ENVIRONMENT_REQUIRED",
          message: "Create the Development environment before enabling capture.",
          requestId: requestId(request),
        },
      });
    const updated = await prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id: session.projectId },
        data: projectInput,
      });
      if (development && captureDevelopmentPayloads !== undefined)
        await tx.environment.update({
          where: { id: development.id },
          data: { capturePayloads: captureDevelopmentPayloads },
        });
      for (const [slug, settings] of Object.entries(logging ?? {}))
        if (settings)
          await tx.environment.updateMany({
            where: { projectId: session.projectId, slug },
            data: {
              logLevel: settings.level,
              logRetentionDays: settings.retentionDays,
              logRetentionMaxEntries: settings.retentionMaxEntries,
              logRetentionMaxBytes: settings.retentionMaxBytes,
            },
          });
      await tx.auditEvent.create({
        data: {
          projectId: session.projectId,
          environmentId: development?.id,
          actorType: "user",
          actorId: session.userId,
          action: "project.settings.updated",
          targetType: "project",
          targetId: session.projectId,
          metadata: {
            name: project.name,
            slug: project.slug,
            fields: Object.keys(input),
          },
        },
      });
      return project;
    });
    return {
      ...updated,
      captureDevelopmentPayloads: captureDevelopmentPayloads ?? undefined,
    };
  });
  app.delete("/api/project-settings", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const input = parse(projectDeleteSchema, request.body);
    const [project, replacement] = await Promise.all([
      prisma.project.findUnique({ where: { id: session.projectId } }),
      prisma.project.findFirst({
        where: { id: { not: session.projectId }, status: "active" },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    if (!project)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Selected project not found",
          requestId: requestId(request),
        },
      });
    if (input.confirmation !== project.slug)
      return reply.status(400).send({
        error: {
          code: "CONFIRMATION_MISMATCH",
          message: "Enter the exact Project slug to confirm deletion.",
          requestId: requestId(request),
        },
      });
    if (!replacement)
      return reply.status(409).send({
        error: {
          code: "LAST_PROJECT",
          message: "Create another active Project before deleting this one.",
          requestId: requestId(request),
        },
      });
    await prisma.$transaction(async (tx) => {
      await tx.functionExecution.deleteMany({
        where: { projectId: session.projectId },
      });
      await tx.project.delete({ where: { id: session.projectId } });
      await tx.auditEvent.create({
        data: {
          actorType: "user",
          actorId: session.userId,
          action: "project.deleted",
          targetType: "project",
          targetId: session.projectId,
          metadata: { name: project.name, slug: project.slug },
        },
      });
    });
    const csrfToken = issueSession(reply, {
      userId: session.userId,
      projectId: replacement.id,
      role: session.role,
      email: session.email,
      sessionVersion: session.sessionVersion,
    });
    return { ok: true, selectedProject: replacement, csrfToken };
  });
}
