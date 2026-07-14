import { type FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import { projectCreateSchema } from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";

export async function registerProjectsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/projects", async () =>
    prisma.project.findMany({
      include: { _count: { select: { endpoints: true, environments: true } } },
      orderBy: { name: "asc" },
    }),
  );
  app.get("/api/projects/:projectId", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        environments: { orderBy: { name: "asc" } },
        endpoints: {
          include: {
            environment: true,
            activeDeployment: true,
            mcpToolBindings: { select: { functionId: true } },
            httpRouteBindings: { select: { functionId: true } },
            _count: {
              select: {
                mcpToolBindings: true,
                httpRouteBindings: true,
              },
            },
          },
          orderBy: { name: "asc" },
        },
      },
    });
    return (
      (project
        ? {
            ...project,
            endpoints: project.endpoints.map((endpoint) => ({
              ...endpoint,
              _count: {
                ...endpoint._count,
                functions: new Set([
                  ...endpoint.mcpToolBindings.map((binding) => binding.functionId),
                  ...endpoint.httpRouteBindings.map((binding) => binding.functionId),
                ]).size,
              },
            })),
          }
        : null) ??
      reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Project not found",
          requestId: requestId(request),
        },
      })
    );
  });
  app.post("/api/projects", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const input = parse(projectCreateSchema, request.body);
    const project = await prisma.$transaction(async (tx) => {
      const installation = await tx.installation.findUnique({
        where: { id: "installation" },
        select: { publicUrl: true },
      });
      const installationUrl =
        installation?.publicUrl ??
        process.env.PUBLIC_RUNTIME_URL ??
        process.env.RUNTIME_PUBLIC_URL ??
        "http://localhost:8080";
      const created = await tx.project.create({ data: input });
      await tx.environment.createMany({
        data: [
          {
            projectId: created.id,
            name: "Development",
            slug: "development",
            capturePayloads: true,
            logLevel: "debug",
            logRetentionDays: 7,
            logRetentionMaxEntries: 50000,
            logRetentionMaxBytes: 52428800,
            baseUrl: installationUrl,
          },
          {
            projectId: created.id,
            name: "Production",
            slug: "production",
            baseUrl: process.env.PRODUCTION_RUNTIME_PUBLIC_URL ?? installationUrl,
            logLevel: "info",
            logRetentionDays: 30,
            logRetentionMaxEntries: 200000,
            logRetentionMaxBytes: 262144000,
          },
        ],
      });
      await tx.auditEvent.create({
        data: {
          projectId: created.id,
          actorType: "user",
          actorId: session.userId,
          action: "project.created",
          targetType: "project",
          targetId: created.id,
          metadata: { name: created.name, slug: created.slug },
        },
      });
      return created;
    });
    return reply.status(201).send(project);
  });
}
