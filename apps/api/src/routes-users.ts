import { type FastifyInstance } from "fastify";
import argon2 from "argon2";
import { prisma } from "@mcpops/db";
import { userCreateSchema, userUpdateSchema } from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";

export async function registerUsersRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/users", async (request) => {
    const session = sessionContext(request);
    requireRole(session, ["owner"]);
    return prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        active: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { email: "asc" },
    });
  });
  app.post("/api/users", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner"]);
    const input = parse(userCreateSchema, request.body);
    const user = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash: await argon2.hash(input.temporaryPassword),
        role: input.role,
        active: true,
        mustChangePassword: true,
      },
      select: {
        id: true,
        email: true,
        role: true,
        active: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await prisma.auditEvent.create({
      data: {
        projectId: session.projectId,
        actorType: "user",
        actorId: session.userId,
        action: "user.created",
        targetType: "user",
        targetId: user.id,
        metadata: { email: user.email, role: user.role },
      },
    });
    return reply.status(201).send(user);
  });
  app.patch("/api/users/:userId", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner"]);
    const { userId } = request.params as { userId: string };
    const input = parse(userUpdateSchema, request.body);
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "User not found",
          requestId: requestId(request),
        },
      });
    if (userId === session.userId && input.active === false)
      return reply.status(409).send({
        error: {
          code: "SELF_LOCKOUT",
          message: "You cannot remove your own access",
          requestId: requestId(request),
        },
      });
    const removesOwner =
      target.role === "owner" &&
      (input.active === false || (input.role !== undefined && input.role !== "owner"));
    if (
      removesOwner &&
      (await prisma.user.count({ where: { role: "owner", active: true } })) <= 1
    )
      return reply.status(409).send({
        error: {
          code: "LAST_OWNER",
          message: "The last active owner cannot be removed or demoted",
          requestId: requestId(request),
        },
      });
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { ...input, sessionVersion: { increment: 1 } },
      select: {
        id: true,
        email: true,
        role: true,
        active: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await prisma.auditEvent.create({
      data: {
        projectId: session.projectId,
        actorType: "user",
        actorId: session.userId,
        action: updated.active ? "user.updated" : "user.access_removed",
        targetType: "user",
        targetId: userId,
        metadata: {
          email: updated.email,
          role: updated.role,
          active: updated.active,
        },
      },
    });
    return updated;
  });
}
