import { type FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@mcpops/db";
import { encryptSecret, secretCreateSchema, secretRotateSchema } from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";

export async function registerSecretsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/secrets", async (request) => {
    const session = sessionContext(request);
    const [secrets, grants] = await Promise.all([
      prisma.secret.findMany({
        where: { projectId: session.projectId },
        select: {
          id: true,
          name: true,
          environmentId: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ environmentId: "asc" }, { name: "asc" }],
      }),
      prisma.secretGrant.findMany({
        where: { function: { projectId: session.projectId } },
        select: {
          secretName: true,
          function: { select: { id: true, name: true } },
        },
      }),
    ]);
    return secrets.map((secret) => {
      const usage = grants
        .filter((grant) => grant.secretName === secret.name)
        .map((grant) => ({
          functionId: grant.function.id,
          functionName: grant.function.name,
        }));
      return { ...secret, grantCount: usage.length, usage };
    });
  });
  app.post("/api/secrets", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const input = parse(secretCreateSchema, request.body);
    const environment = await prisma.environment.findFirst({
      where: { id: input.environmentId, projectId: session.projectId },
    });
    if (!environment)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Environment not found",
          requestId: requestId(request),
        },
      });
    if (
      await prisma.secret.findFirst({
        where: {
          projectId: session.projectId,
          environmentId: input.environmentId,
          name: input.name,
        },
        select: { id: true },
      })
    )
      return reply.status(409).send({
        error: {
          code: "SECRET_NAME_CONFLICT",
          message: "A secret with this name already exists in the environment",
          requestId: requestId(request),
        },
      });
    const secret = await prisma.secret.create({
      data: {
        projectId: session.projectId,
        environmentId: input.environmentId,
        name: input.name,
        encryptedValue: encryptSecret(input.value),
      },
      select: { id: true, name: true, environmentId: true, createdAt: true },
    });
    await prisma.auditEvent.create({
      data: {
        projectId: session.projectId,
        environmentId: input.environmentId,
        actorType: "user",
        actorId: session.userId,
        action: "secret.created",
        targetType: "secret",
        targetId: secret.id,
        metadata: { name: secret.name },
      },
    });
    return reply.status(201).send(secret);
  });
  const synchronizedSecretSchema = z
    .object({
      name: z.string().regex(/^[A-Z][A-Z0-9_]{1,99}$/),
      developmentValue: z.string().min(1).max(16_384),
      productionValue: z.string().min(1).max(16_384),
    })
    .strict();

  app.post("/api/secrets/sync", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const input = parse(synchronizedSecretSchema, request.body);
    const environments = await prisma.environment.findMany({
      where: {
        projectId: session.projectId,
        slug: { in: ["development", "production"] },
      },
      select: { id: true, slug: true },
    });
    const bySlug = new Map(
      environments.map((environment) => [environment.slug, environment]),
    );
    if (!bySlug.has("development") || !bySlug.has("production"))
      return reply.status(409).send({
        error: {
          code: "SECRET_ENVIRONMENTS_MISSING",
          message:
            "Development and Production environments are required for synchronized Secrets",
          requestId: requestId(request),
        },
      });
    const values = [
      {
        environment: bySlug.get("development") as { id: string; slug: string },
        value: input.developmentValue,
      },
      {
        environment: bySlug.get("production") as { id: string; slug: string },
        value: input.productionValue,
      },
    ];
    const result = await prisma.$transaction(async (tx) => {
      const rows = [];
      for (const { environment, value } of values) {
        const existing = await tx.secret.findUnique({
          where: {
            projectId_environmentId_name: {
              projectId: session.projectId,
              environmentId: environment.id,
              name: input.name,
            },
          },
          select: { id: true },
        });
        const secret = await tx.secret.upsert({
          where: {
            projectId_environmentId_name: {
              projectId: session.projectId,
              environmentId: environment.id,
              name: input.name,
            },
          },
          create: {
            projectId: session.projectId,
            environmentId: environment.id,
            name: input.name,
            encryptedValue: encryptSecret(value),
          },
          update: { encryptedValue: encryptSecret(value) },
          select: {
            id: true,
            name: true,
            environmentId: true,
            updatedAt: true,
          },
        });
        await tx.auditEvent.create({
          data: {
            projectId: session.projectId,
            environmentId: environment.id,
            actorType: "user",
            actorId: session.userId,
            action: existing ? "secret.rotated" : "secret.created",
            targetType: "secret",
            targetId: secret.id,
            metadata: { name: secret.name, synchronized: true },
          },
        });
        rows.push({ ...secret, environment: environment.slug });
      }
      return rows;
    });
    return reply.status(200).send({ name: input.name, environments: result });
  });

  app.delete("/api/secrets/sync/:name", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { name } = request.params as { name: string };
    if (!/^[A-Z][A-Z0-9_]{1,99}$/.test(name))
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Secret name is invalid",
          requestId: requestId(request),
        },
      });
    const secrets = await prisma.secret.findMany({
      where: { projectId: session.projectId, name },
      include: { _count: { select: { databaseConnections: true } } },
    });
    if (!secrets.length)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Secret not found",
          requestId: requestId(request),
        },
      });
    const grantCount = await prisma.secretGrant.count({
      where: { secretName: name, function: { projectId: session.projectId } },
    });
    if (grantCount || secrets.some((secret) => secret._count.databaseConnections > 0))
      return reply.status(409).send({
        error: {
          code: "SECRET_IN_USE",
          message:
            "Remove all function grants and database connections before deleting this Secret",
          requestId: requestId(request),
        },
      });
    await prisma.$transaction(async (tx) => {
      await tx.secret.deleteMany({
        where: { projectId: session.projectId, name },
      });
      for (const secret of secrets)
        await tx.auditEvent.create({
          data: {
            projectId: session.projectId,
            environmentId: secret.environmentId,
            actorType: "user",
            actorId: session.userId,
            action: "secret.deleted",
            targetType: "secret",
            targetId: secret.id,
            metadata: { name, synchronized: true },
          },
        });
    });
    return reply.status(204).send();
  });
  app.post("/api/secrets/:secretId/rotate", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { secretId } = request.params as { secretId: string };
    const { value } = parse(secretRotateSchema, request.body);
    const secret = await prisma.secret.findFirst({
      where: { id: secretId, projectId: session.projectId },
    });
    if (!secret)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Secret not found",
          requestId: requestId(request),
        },
      });
    await prisma.secret.update({
      where: { id: secretId },
      data: { encryptedValue: encryptSecret(value) },
    });
    await prisma.auditEvent.create({
      data: {
        projectId: session.projectId,
        environmentId: secret.environmentId,
        actorType: "user",
        actorId: session.userId,
        action: "secret.rotated",
        targetType: "secret",
        targetId: secret.id,
        metadata: { name: secret.name },
      },
    });
    return { id: secret.id, name: secret.name, rotatedAt: new Date() };
  });
  app.delete("/api/secrets/:secretId", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { secretId } = request.params as { secretId: string };
    const secret = await prisma.secret.findFirst({
      where: { id: secretId, projectId: session.projectId },
      include: {
        _count: { select: { databaseConnections: true } },
      },
    });
    if (!secret)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Secret not found",
          requestId: requestId(request),
        },
      });
    const grantCount = await prisma.secretGrant.count({
      where: {
        secretName: secret.name,
        function: { projectId: session.projectId },
      },
    });
    if (grantCount || secret._count.databaseConnections)
      return reply.status(409).send({
        error: {
          code: "SECRET_IN_USE",
          message:
            "Remove all function grants and database connections before deleting this secret",
          requestId: requestId(request),
        },
      });
    await prisma.$transaction([
      prisma.secret.delete({ where: { id: secretId } }),
      prisma.auditEvent.create({
        data: {
          projectId: session.projectId,
          environmentId: secret.environmentId,
          actorType: "user",
          actorId: session.userId,
          action: "secret.deleted",
          targetType: "secret",
          targetId: secret.id,
          metadata: { name: secret.name },
        },
      }),
    ]);
    return reply.status(204).send();
  });
}
