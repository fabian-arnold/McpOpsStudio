import { type FastifyInstance } from "fastify";
import argon2 from "argon2";
import { prisma } from "@mcpops/db";
import { loginSchema, passwordChangeSchema } from "@mcpops/shared";
import { clearSession, issueSession } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";
import { deploymentQueue } from "./resources.js";
import { registerInstallationRoutes } from "./installation.js";

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    status: "ok",
    endpoint: "control-plane-api",
  }));
  registerInstallationRoutes(app, deploymentQueue);
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = parse(loginSchema, request.body);
      const user = await prisma.user.findUnique({
        where: { email: input.email.toLowerCase() },
      });
      if (!user?.active || !(await argon2.verify(user.passwordHash, input.password)))
        return reply.status(401).send({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Email or password is incorrect",
            requestId: requestId(request),
          },
        });
      const project = await prisma.project.findFirst({
        where: { status: "active" },
        orderBy: { createdAt: "asc" },
      });
      if (!project)
        return reply.status(503).send({
          error: {
            code: "NO_ACTIVE_PROJECT",
            message: "No active project is configured",
            requestId: requestId(request),
          },
        });
      const csrfToken = issueSession(reply, {
        userId: user.id,
        projectId: project.id,
        role: user.role,
        email: user.email,
        sessionVersion: user.sessionVersion,
      });
      await prisma.auditEvent.create({
        data: {
          projectId: project.id,
          actorType: "user",
          actorId: user.id,
          action: "platform.login",
          targetType: "session",
          metadata: { requestId: requestId(request) },
        },
      });
      return {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
          project,
        },
        csrfToken,
      };
    },
  );
  app.post("/api/auth/logout", async (request, reply) => {
    clearSession(reply);
    return { ok: true };
  });
  app.get("/api/auth/me", async (request, reply) => {
    const session = sessionContext(request);
    const [user, project] = await Promise.all([
      prisma.user.findFirst({ where: { id: session.userId, active: true } }),
      prisma.project.findUnique({ where: { id: session.projectId } }),
    ]);
    if (!user) {
      clearSession(reply);
      return reply.status(401).send({
        error: {
          code: "UNAUTHENTICATED",
          message: "Session is no longer valid",
          requestId: requestId(request),
        },
      });
    }
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        project,
      },
      csrfToken: request.cookies.mcpops_csrf,
    };
  });

  app.post("/api/account/password", async (request, reply) => {
    const session = sessionContext(request);
    const input = parse(passwordChangeSchema, request.body);
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (
      !user?.active ||
      !(await argon2.verify(user.passwordHash, input.currentPassword))
    )
      return reply.status(400).send({
        error: {
          code: "CURRENT_PASSWORD_INVALID",
          message: "Current password is incorrect",
          requestId: requestId(request),
        },
      });
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await argon2.hash(input.newPassword),
        mustChangePassword: false,
        sessionVersion: { increment: 1 },
      },
    });
    await prisma.auditEvent.create({
      data: {
        projectId: session.projectId,
        actorType: "user",
        actorId: user.id,
        action: "user.password_changed",
        targetType: "user",
        targetId: user.id,
        metadata: {},
      },
    });
    clearSession(reply);
    return { ok: true, sessionVersion: updated.sessionVersion, signedOut: true };
  });
}
