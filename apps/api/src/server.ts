import Fastify from "fastify";
import type { FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import argon2 from "argon2";
import { Ajv } from "ajv";
import { bundleFunction } from "@mcpops/sandbox";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { prisma } from "@mcpops/db";
import {
  authPolicyMutationSchema,
  canonicalJson,
  encryptSecret,
  functionCreateSchema,
  functionTemplates,
  functionUpdateSchema,
  httpBindingSchema,
  loginSchema,
  manifestImportSchema,
  mcpBindingSchema,
  parseManifest,
  redactSensitive,
  resolveFunctionCallGraph,
  secretCreateSchema,
  secretRotateSchema,
  serializeManifest,
  endpointCreateSchema,
  testInvocationSchema,
  deploymentRuntimeConfigSchema,
  projectLibrarySchema,
  networkPolicyUpdateSchema,
  cachePurgeSchema,
  endpointListQuerySchema,
  endpointStatusSchema,
  globalSearchQuerySchema,
  endpointSettingsUpdateSchema,
  projectCreateSchema,
  projectUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
  passwordChangeSchema,
  type EndpointManifest,
} from "@mcpops/shared";
import {
  clearSession,
  enforceCsrf,
  issueSession,
  requireRole,
  type PlatformSession,
} from "./auth.js";
import {
  checksum,
  sessionContext,
  parse,
  requestId,
  sendError,
} from "./helpers.js";
import {
  functionIdentifierWhere,
  projectRepository,
  endpointIdentifierWhere,
} from "./repository.js";
import {
  canonicalEndpointUrls,
  hourlyTraffic,
  policySummary,
  summarizeDeployments,
  summarizeExecutions,
  DAY_MS,
} from "./analytics.js";
import {
  networkPolicyWarnings,
  providerStatus,
  validateProjectLibrary,
} from "./control-plane-validation.js";
import {
  auditListQuerySchema,
  csv,
  deploymentListQuerySchema,
  executionListQuerySchema,
} from "./listing.js";
import { platformCapabilities } from "./capabilities.js";
import {
  previewTemplateInstallation,
  templateInstallSelectionSchema,
} from "./template-install.js";
import { buildManifestPlan } from "./manifest-plan.js";
import { registerReviewedDatabaseRoutes } from "./reviewed-database-routes.js";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  genReqId: (req) => String(req.headers["x-request-id"] ?? crypto.randomUUID()),
});
await app.register(cookie);
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, {
  origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  credentials: true,
});
await app.register(rateLimit, {
  max: 300,
  timeWindow: "1 minute",
  keyGenerator: (req) => req.ip,
});
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const deploymentQueue = new Queue("deployments", {
  connection: {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    ...(redisUrl.password
      ? { password: decodeURIComponent(redisUrl.password) }
      : {}),
  },
});
const cacheInspector = new Redis(redisUrl.toString(), {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

app.setErrorHandler((error, request, reply) =>
  sendError(reply, request, error),
);
app.addHook("onRequest", async (request, reply) => {
  reply.header("x-request-id", requestId(request));
});
app.addHook("preHandler", async (request, reply) => {
  if (
    request.url.startsWith("/api/auth/login") ||
    request.url.startsWith("/health")
  )
    return;
  if (request.url.startsWith("/api/")) {
    const session = sessionContext(request);
    const sessionUser = await prisma.user.findFirst({
      where: { id: session.userId, active: true },
      select: {
        id: true,
        role: true,
        active: true,
        mustChangePassword: true,
        sessionVersion: true,
      },
    });
    if (
      !sessionUser ||
      !sessionUser.active ||
      sessionUser.sessionVersion !== session.sessionVersion ||
      sessionUser.role !== session.role
    ) {
      clearSession(reply);
      return reply.status(401).send({
        error: {
          code: "UNAUTHENTICATED",
          message: "Session is no longer valid",
          requestId: requestId(request),
        },
      });
    }
    if (
      sessionUser.mustChangePassword &&
      !request.url.startsWith("/api/auth/me") &&
      !request.url.startsWith("/api/auth/logout") &&
      !request.url.startsWith("/api/account/password")
    ) {
      return reply.status(403).send({
        error: {
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "Change the temporary password before continuing",
          requestId: requestId(request),
        },
      });
    }
    enforceCsrf(request);

    // Browser routes use stable slugs/names in a few convenient links. Resolve
    // them before handlers use UUID-backed Prisma columns so invalid UUID text
    // produces a safe 404 instead of a database conversion error.
    const params = request.params as {
      endpointId?: string;
      functionId?: string;
    };
    if (params.endpointId) {
      const endpoint = await prisma.runtimeEndpoint.findFirst({
        where: {
          projectId: session.projectId,
          ...endpointIdentifierWhere(params.endpointId),
        },
        select: { id: true },
      });
      if (!endpoint)
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Runtime endpoint not found",
            requestId: requestId(request),
          },
        });
      params.endpointId = endpoint.id;

      if (params.functionId && params.functionId !== "new") {
        const fn = await prisma.function.findFirst({
          where: {
            projectId: session.projectId,
            ...functionIdentifierWhere(params.functionId),
          },
          select: { id: true },
        });
        if (!fn)
          return reply.status(404).send({
            error: {
              code: "NOT_FOUND",
              message: "Function not found",
              requestId: requestId(request),
            },
          });
        params.functionId = fn.id;
      }
    }
    const cursor = (request.query as { cursor?: unknown }).cursor;
    if (
      typeof cursor === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        cursor,
      )
    ) {
      if (request.url.startsWith("/api/executions"))
        await assertScopedCursor("execution", session.projectId, cursor);
      else if (request.url.startsWith("/api/deployments"))
        await assertScopedCursor("deployment", session.projectId, cursor);
      else if (request.url.startsWith("/api/audit-events"))
        await assertScopedCursor("audit", session.projectId, cursor);
    }
  }
});

app.get("/health", async () => ({
  status: "ok",
  endpoint: "control-plane-api",
}));
app.post(
  "/api/auth/login",
  { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
  async (request, reply) => {
    const input = parse(loginSchema, request.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    if (
      !user?.active ||
      !(await argon2.verify(user.passwordHash, input.password))
    )
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
                ...endpoint.httpRouteBindings.map(
                  (binding) => binding.functionId,
                ),
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
    const created = await tx.project.create({ data: input });
    await tx.environment.createMany({
      data: [
        {
          projectId: created.id,
          name: "Development",
          slug: "development",
          baseUrl: process.env.RUNTIME_PUBLIC_URL ?? "http://localhost:8080",
        },
        {
          projectId: created.id,
          name: "Production",
          slug: "production",
          baseUrl:
            process.env.PRODUCTION_RUNTIME_PUBLIC_URL ??
            "http://prod.localhost:8080",
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
      metadata: { fields: Object.keys(input) },
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
        metadata: {},
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
        message: "Archive the project or remove its runtime endpoints before deletion",
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
    (input.active === false ||
      (input.role !== undefined && input.role !== "owner"));
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
      metadata: { role: updated.role, active: updated.active },
    },
  });
  return updated;
});

app.get("/api/environments", async (request) =>
  projectRepository(sessionContext(request).projectId).environments(),
);
app.get("/api/search", async (request) => {
  const session = sessionContext(request);
  const { q, limit } = parse(globalSearchQuerySchema, request.query);
  const [endpoints, functions, libraries] = await Promise.all([
    prisma.runtimeEndpoint.findMany({
      where: {
        projectId: session.projectId,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { slug: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        kind: true,
        environment: { select: { id: true, name: true } },
      },
      take: limit,
    }),
    prisma.function.findMany({
      where: {
        projectId: session.projectId,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        title: true,
      },
      take: limit,
    }),
    prisma.projectLibrary.findMany({
      where: {
        projectId: session.projectId,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { importPath: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, importPath: true, version: true },
      distinct: ["importPath"],
      orderBy: { version: "desc" },
      take: limit,
    }),
  ]);
  return {
    query: q,
    results: [
      ...endpoints.map((endpoint) => ({
        type: "endpoint",
        id: endpoint.id,
        title: endpoint.name,
        subtitle: endpoint.environment.name,
        href:
          endpoint.kind === "mcp"
            ? `/mcp-endpoints/${endpoint.id}`
            : `/http-apis/${endpoint.id}`,
      })),
      ...functions.map((fn) => ({
        type: "function",
        id: fn.id,
        title: fn.title,
        subtitle: "Project Function",
        href: `/functions/${fn.id}`,
      })),
      ...libraries.map((library) => ({
        type: "library",
        id: library.id,
        title: library.name,
        subtitle: `${library.importPath} Â· v${library.version}`,
        href: "/libraries",
      })),
    ].slice(0, limit),
  };
});
app.get("/api/notifications", async (request) => {
  const session = sessionContext(request);
  const [audits, failedDeployments] = await Promise.all([
    prisma.auditEvent.findMany({
      where: {
        projectId: session.projectId,
        action: {
          in: [
            "function.invoke.denied",
            "deployment.rolled_back",
            "secret.rotated",
            "endpoint.disabled",
          ],
        },
      },
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.deployment.findMany({
      where: { endpoint: { projectId: session.projectId }, status: "failed" },
      select: {
        id: true,
        version: true,
        completedAt: true,
        endpoint: { select: { id: true, name: true } },
      },
      orderBy: { completedAt: "desc" },
      take: 10,
    }),
  ]);
  const items = [
    ...audits.map((event) => ({
      id: `audit:${event.id}`,
      kind: "audit",
      severity: event.action.includes("denied") ? "warning" : "info",
      title: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      createdAt: event.createdAt,
    })),
    ...failedDeployments.map((deployment) => ({
      id: `deployment:${deployment.id}`,
      kind: "deployment",
      severity: "error",
      title: `Deployment v${deployment.version} failed`,
      endpointId: deployment.endpoint.id,
      endpointName: deployment.endpoint.name,
      createdAt: deployment.completedAt,
    })),
  ]
    .sort(
      (left, right) =>
        (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0),
    )
    .slice(0, 20);
  return { items, readStateSupported: false };
});
app.get("/api/account/security", async (request) => {
  const session = sessionContext(request);
  return {
    authentication: {
      provider: "local_password",
      mfaSupported: false,
      oidcStatus: "deferred",
      entraIdStatus: "deferred",
    },
    session: {
      email: session.email,
      role: session.role,
      expiresAt: new Date(session.expiresAt),
    },
  };
});
app.get("/api/capabilities", async () => platformCapabilities());
await registerReviewedDatabaseRoutes(app);
app.get("/api/dashboard", async (request) => {
  const { projectId } = sessionContext(request);
  const now = new Date();
  const since = new Date(now.getTime() - 2 * DAY_MS);
  const currentSince = new Date(now.getTime() - DAY_MS);
  const [
    endpointCount,
    activeEndpointCount,
    executionSamples,
    deployments,
    recentFailedDeployments,
    auditEvents,
    recentExecutions,
    recentFailures,
    redisHealth,
  ] = await Promise.all([
    prisma.runtimeEndpoint.count({ where: { projectId, status: "deployed" } }),
    prisma.runtimeEndpoint.count({
      where: {
        projectId,
        status: "deployed",
        activeDeploymentId: { not: null },
      },
    }),
    prisma.functionExecution.findMany({
      where: { projectId, createdAt: { gte: since, lte: now } },
      select: { createdAt: true, durationMs: true, status: true },
    }),
    prisma.deployment.findMany({
      where: { endpoint: { projectId }, status: "active" },
      include: { endpoint: { include: { project: true, environment: true } } },
      take: 10,
      orderBy: { completedAt: "desc" },
    }),
    prisma.deployment.findMany({
      where: {
        endpoint: { projectId },
        status: "failed",
        createdAt: { gte: currentSince },
      },
      select: {
        id: true,
        version: true,
        createdAt: true,
        completedAt: true,
        endpoint: { select: { id: true, name: true } },
      },
      take: 5,
      orderBy: { createdAt: "desc" },
    }),
    prisma.auditEvent.findMany({
      where: { projectId },
      take: 10,
      orderBy: { createdAt: "desc" },
    }),
    prisma.functionExecution.findMany({
      where: { projectId },
      include: { function: true, deployment: true, functionVersion: true },
      take: 8,
      orderBy: { createdAt: "desc" },
    }),
    prisma.functionExecution.findMany({
      where: {
        projectId,
        createdAt: { gte: currentSince },
        status: { in: ["error", "timeout", "validation_error", "denied"] },
      },
      include: { function: true, deployment: true, functionVersion: true },
      take: 8,
      orderBy: { createdAt: "desc" },
    }),
    probeRedisDependency(),
  ]);
  const executionSummary = summarizeExecutions(executionSamples, now);
  const trafficBuckets = hourlyTraffic(executionSamples, now);
  const activeDeployments = deployments.map((deployment) => ({
    id: deployment.id,
    version: deployment.version,
    checksum: deployment.checksum,
    completedAt: deployment.completedAt,
    endpoint: {
      id: deployment.endpoint.id,
      name: deployment.endpoint.name,
      slug: deployment.endpoint.slug,
      kind: deployment.endpoint.kind,
    },
    endpoints: canonicalEndpointUrls(
      deployment.endpoint.environment.baseUrl,
      deployment.endpoint.project.slug,
      deployment.endpoint.slug,
    ),
  }));
  return {
    context: {
      generatedAt: now,
      window: "24h",
      previousWindow: "preceding_24h",
      bucketMinutes: 60,
    },
    stats: {
      endpoints: endpointCount,
      calls24h: executionSummary.current.calls,
      failedCalls24h: executionSummary.current.failures,
      errorRate: executionSummary.current.errorRate,
      averageLatencyMs: executionSummary.current.averageLatencyMs,
      p95LatencyMs: executionSummary.current.p95LatencyMs,
      activeDeployments: activeEndpointCount,
    },
    comparisons: executionSummary.comparisons,
    trafficBuckets,
    sparkline: trafficBuckets.map((bucket) => bucket.calls),
    health: {
      status:
        recentFailedDeployments.length ||
        activeEndpointCount < endpointCount ||
        redisHealth !== "healthy"
          ? "degraded"
          : "healthy",
      database: "healthy",
      redis: redisHealth,
      deployedEndpoints: endpointCount,
      endpointsWithActiveSnapshot: activeEndpointCount,
      endpointsWithoutActiveSnapshot: Math.max(0, endpointCount - activeEndpointCount),
      failedDeployments24h: recentFailedDeployments.length,
    },
    activeDeployments,
    recentFailedDeployments,
    recentFailures: recentFailures.map(executionView),
    recentExecutions: recentExecutions.map(executionView),
    auditEvents: auditEvents.map(auditView),
  };
});

app.get("/api/runtime-endpoints", async (request) => {
  const session = sessionContext(request);
  const query = parse(endpointListQuerySchema, request.query);
  return (await projectRepository(session.projectId).endpoints(query)).map(
    endpointView,
  );
});
app.get("/api/binding-map", async (request) => {
  const session = sessionContext(request);
  return prisma.runtimeEndpoint.findMany({
    where: { projectId: session.projectId },
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      status: true,
      mcpToolBindings: {
        select: {
          id: true,
          functionId: true,
          toolName: true,
          title: true,
          enabled: true,
        },
        orderBy: { toolName: "asc" },
      },
      httpRouteBindings: {
        select: {
          id: true,
          functionId: true,
          method: true,
          path: true,
          enabled: true,
        },
        orderBy: [{ path: "asc" }, { method: "asc" }],
      },
    },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
});
app.post("/api/runtime-endpoints", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "developer"]);
  const input = parse(endpointCreateSchema, request.body);
  const environment = await prisma.environment.findFirst({
    where: { projectId: session.projectId, slug: "development" },
  });
  if (!environment)
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Development environment not found",
        requestId: requestId(request),
      },
    });
  const collision = await prisma.runtimeEndpoint.findFirst({
    where: { projectId: session.projectId, kind: input.kind, slug: input.slug },
    select: { id: true },
  });
  if (collision)
    return reply.status(409).send({
      error: {
        code: "ENDPOINT_SLUG_CONFLICT",
        message: `A ${input.kind.toUpperCase()} endpoint with this slug already exists in the project`,
        requestId: requestId(request),
      },
    });
  const defaultAuthPolicy = await prisma.authPolicy.findFirst({
    where: { projectId: session.projectId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const endpoint = await prisma.$transaction(async (tx) => {
    const created = await tx.runtimeEndpoint.create({
      data: {
        projectId: session.projectId,
        ...input,
        environmentId: environment.id,
        defaultAuthPolicyId: defaultAuthPolicy?.id,
        status: "draft",
        runtimeVersion: "1.0.0",
      },
      include: {
        project: true,
        environment: true,
        defaultAuthPolicy: true,
        activeDeployment: true,
        _count: {
          select: {
            mcpToolBindings: true,
            httpRouteBindings: true,
          },
        },
      },
    });
    await tx.auditEvent.create({
      data: {
        projectId: session.projectId,
        environmentId: environment.id,
        endpointId: created.id,
        actorType: "user",
        actorId: session.userId,
        action: "endpoint.created",
        targetType: "runtime_endpoint",
        targetId: created.id,
        metadata: { name: created.name, slug: created.slug },
      },
    });
    return created;
  });
  return reply.status(201).send(endpointView(endpoint));
});
app.get("/api/runtime-endpoints/:endpointId", async (request, reply) => {
  const session = sessionContext(request);
  const { endpointId } = request.params as { endpointId: string };
  const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
  if (!endpoint)
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Runtime endpoint not found",
        requestId: requestId(request),
      },
    });
  const telemetrySince = new Date(Date.now() - 2 * DAY_MS);
  const [
    authPolicies,
    secrets,
    libraries,
    executions,
    telemetrySamples,
    storageMetrics,
    cacheMetrics,
    runtimeHealth,
  ] = await Promise.all([
    prisma.authPolicy.findMany({
      where: { projectId: session.projectId },
      orderBy: { name: "asc" },
    }),
    prisma.secret.findMany({
      where: {
        projectId: session.projectId,
        environmentId: endpoint.environmentId,
      },
      select: {
        id: true,
        name: true,
        environment: { select: { name: true } },
        updatedAt: true,
        _count: { select: { grants: true } },
      },
    }),
    prisma.projectLibrary.findMany({
      where: { projectId: session.projectId },
      orderBy: [{ name: "asc" }, { version: "desc" }],
    }),
    prisma.functionExecution.findMany({
      where: { projectId: session.projectId, endpointId },
      include: {
        function: true,
        functionVersion: true,
        deployment: true,
        mcpToolBinding: true,
        httpRouteBinding: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.functionExecution.findMany({
      where: {
        projectId: session.projectId,
        endpointId,
        createdAt: { gte: telemetrySince },
      },
      select: { createdAt: true, durationMs: true, status: true },
    }),
    inspectStorageMetadata(session.projectId, endpoint.environmentId),
    inspectCacheMetadata(session.projectId, endpoint.environmentId),
    probeRuntimeEndpoint(endpointId),
  ]);
  const telemetry = summarizeExecutions(telemetrySamples);
  const securityPosture = {
    ...policySummary(
      endpoint.activeDeployment?.snapshot,
      endpoint.defaultAuthPolicy,
    ),
    network: endpoint.networkPolicy
      ? {
          configured: true,
          allowedHostCount: Array.isArray(endpoint.networkPolicy.allowedHosts)
            ? endpoint.networkPolicy.allowedHosts.length
            : 0,
          allowedMethods: Array.isArray(endpoint.networkPolicy.allowedMethods)
            ? endpoint.networkPolicy.allowedMethods
            : [],
          maxResponseBytes: endpoint.networkPolicy.maxResponseBytes,
        }
      : {
          configured: false,
          allowedHostCount: 0,
          allowedMethods: [],
          maxResponseBytes: null,
        },
    trustedDeveloperExecution: true,
  };
  return {
    ...endpointView({
      ...endpoint,
      _count: {
        mcpToolBindings: endpoint.mcpToolBindings.length,
        httpRouteBindings: endpoint.httpRouteBindings.length,
      },
      defaultAuthPolicy: endpoint.defaultAuthPolicy,
    }),
    telemetry: {
      ...telemetry.current,
      comparisons: telemetry.comparisons,
      window: "24h",
    },
    runtimeHealth: {
      ...runtimeHealth,
      status:
        runtimeHealth.status === "unavailable"
          ? "unavailable"
          : runtimeHealth.status === "healthy" &&
              cacheMetrics.status === "available"
            ? "healthy"
            : "degraded",
      dependencies: {
        controlPlaneDatabase: "healthy",
        cache: cacheMetrics.status === "available" ? "healthy" : "unavailable",
        activeDeployment: runtimeHealth.activeDeploymentLoadable
          ? "healthy"
          : "unavailable",
      },
    },
    securityPosture,
    storageMetrics: { storage: storageMetrics, cache: cacheMetrics },
    functions: endpoint.functions.map(functionView),
    mcpBindings: endpoint.mcpToolBindings,
    httpBindings: endpoint.httpRouteBindings,
    deployments: endpoint.deployments.map((deployment) => ({
      ...deployment,
      functionVersions: Array.isArray(
        (deployment.snapshot as { functions?: unknown[] }).functions,
      )
        ? (deployment.snapshot as { functions: unknown[] }).functions.length
        : 0,
    })),
    executions: executions.map(executionView),
    authPolicies: authPolicies.map(policyView),
    secrets: secrets.map((secret) => ({
      id: secret.id,
      name: secret.name,
      environment: secret.environment.name,
      grants: secret._count.grants,
      updatedAt: secret.updatedAt,
    })),
    libraries,
    networkPolicy: networkPolicyView(endpoint.networkPolicy),
  };
});
app.patch("/api/runtime-endpoints/:endpointId", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "developer"]);
  const { endpointId } = request.params as { endpointId: string };
  const current = await projectRepository(session.projectId).endpoint(endpointId);
  if (!current)
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Runtime endpoint not found",
        requestId: requestId(request),
      },
    });
  const input = parse(endpointCreateSchema.omit({ kind: true }).partial(), request.body);
  if (input.slug && input.slug !== current.slug) {
    const collision = await prisma.runtimeEndpoint.findFirst({
      where: {
        projectId: session.projectId,
        kind: current.kind,
        slug: input.slug ?? current.slug,
        id: { not: endpointId },
      },
      select: { id: true },
    });
    if (collision)
      return reply.status(409).send({
        error: {
          code: "ENDPOINT_SLUG_CONFLICT",
          message: "An endpoint of this type already uses this slug in the project",
          requestId: requestId(request),
        },
      });
  }
  const updated = await prisma.runtimeEndpoint.update({
    where: { id: endpointId },
    data: input,
  });
  await writeControlAudit(
    session,
    endpointId,
    "endpoint.updated",
    "runtime_endpoint",
    endpointId,
    { fields: Object.keys(input) },
  );
  return updated;
});

app.get("/api/runtime-endpoints/:endpointId/test-targets", async (request) => {
  const session = sessionContext(request);
  const { endpointId } = request.params as { endpointId: string };
  const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
  if (!endpoint)
    throw Object.assign(new Error("Runtime endpoint not found"), { statusCode: 404 });
  return {
    activeDeploymentId: endpoint.activeDeploymentId,
    targets: endpoint.functions
      .filter((fn) => fn.enabled)
      .map((fn) => ({
        functionId: fn.id,
        name: fn.name,
        title: fn.title,
        riskLevel: fn.riskLevel,
        mcpTools: endpoint.mcpToolBindings
          .filter((binding) => binding.enabled && binding.functionId === fn.id)
          .map((binding) => ({ id: binding.id, toolName: binding.toolName })),
        httpRoutes: endpoint.httpRouteBindings
          .filter((binding) => binding.enabled && binding.functionId === fn.id)
          .map((binding) => ({
            id: binding.id,
            method: binding.method,
            path: binding.path,
          })),
        testUrl: `/api/runtime-endpoints/${endpointId}/functions/${fn.id}/test`,
      })),
  };
});
app.get("/api/runtime-endpoints/:endpointId/settings", async (request) => {
  const session = sessionContext(request);
  const { endpointId } = request.params as { endpointId: string };
  const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
  if (!endpoint)
    throw Object.assign(new Error("Runtime endpoint not found"), { statusCode: 404 });
  return endpointSettingsView(endpoint);
});
app.patch("/api/runtime-endpoints/:endpointId/settings", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "developer"]);
  const { endpointId } = request.params as { endpointId: string };
  const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
  if (!endpoint)
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Runtime endpoint not found",
        requestId: requestId(request),
      },
    });
  const input = parse(endpointSettingsUpdateSchema, request.body);
  if (
    await prisma.runtimeEndpoint.findFirst({
      where: {
        projectId: session.projectId,
        environmentId: endpoint.environmentId,
        slug: input.slug,
        id: { not: endpointId },
      },
      select: { id: true },
    })
  )
    return reply.status(409).send({
      error: {
        code: "SERVICE_SLUG_CONFLICT",
        message: "A endpoint with this slug already exists in the environment",
        requestId: requestId(request),
      },
    });
  const runtimeConfig = {
    timeoutMs: input.runtime.timeoutMs,
    maxConcurrentRequests: input.runtime.maxConcurrentRequests,
    env: input.env,
    endpointAccessPolicy: input.endpointAccessPolicy,
  };
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.runtimeEndpoint.update({
      where: { id: endpointId },
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        runtimeVersion: input.runtimeVersion,
        runtimeConfig,
      },
    });
    await tx.auditEvent.create({
      data: {
        projectId: session.projectId,
        environmentId: endpoint.environmentId,
        endpointId,
        actorType: "user",
        actorId: session.userId,
        action: "endpoint.settings.updated",
        targetType: "runtime_endpoint",
        targetId: endpointId,
        metadata: {
          runtimeVersion: input.runtimeVersion,
          timeoutMs: input.runtime.timeoutMs,
          maxConcurrentRequests: input.runtime.maxConcurrentRequests,
          environmentVariableNames: Object.keys(input.env),
          endpointAccessMode: input.endpointAccessPolicy.mode,
        },
      },
    });
    return row;
  });
  return endpointSettingsView({ ...endpoint, ...updated });
});
app.get("/api/runtime-endpoints/:endpointId/network-policy", async (request) => {
  const session = sessionContext(request);
  const { endpointId } = request.params as { endpointId: string };
  const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
  if (!endpoint)
    throw Object.assign(new Error("Runtime endpoint not found"), { statusCode: 404 });
  return networkPolicyView(endpoint.networkPolicy);
});
app.put("/api/runtime-endpoints/:endpointId/network-policy", async (request) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin"]);
  const { endpointId } = request.params as { endpointId: string };
  const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
  if (!endpoint)
    throw Object.assign(new Error("Runtime endpoint not found"), { statusCode: 404 });
  const parsed = parse(networkPolicyUpdateSchema, request.body);
  const input = {
    ...parsed,
    allowPrivateHosts: parsed.allowPrivateHosts ?? [],
  };
  const policy = await prisma.networkPolicy.upsert({
    where: { endpointId },
    create: { projectId: session.projectId, endpointId, ...input },
    update: input,
  });
  await writeControlAudit(
    session,
    endpointId,
    "network_policy.updated",
    "network_policy",
    policy.id,
    {
      allowedHosts: input.allowedHosts,
      allowedMethods: input.allowedMethods,
      allowedPorts: input.allowedPorts,
      allowPrivateHosts: input.allowPrivateHosts,
      maxResponseBytes: input.maxResponseBytes,
      warningCodes: networkPolicyWarnings(
        input.allowedHosts,
        input.allowPrivateHosts,
      ).map((warning) => warning.code),
    },
  );
  return networkPolicyView(policy);
});
app.get("/api/runtime-endpoints/:endpointId/storage/namespaces", async (request) => {
  const session = sessionContext(request);
  const { endpointId } = request.params as { endpointId: string };
  const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
  if (!endpoint)
    throw Object.assign(new Error("Runtime endpoint not found"), { statusCode: 404 });
  const now = new Date();
  const namespaces = await prisma.storageNamespace.findMany({
    where: {
      projectId: session.projectId,
      environmentId: endpoint.environmentId,
    },
    select: {
      id: true,
      name: true,
      environmentId: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { entries: true } },
    },
    orderBy: { name: "asc" },
  });
  return {
    valuesExposed: false,
    keyMaterialExposed: false,
    namespaces: await Promise.all(
      namespaces.map(async (namespace) => ({
        id: namespace.id,
        name: namespace.name,
        environmentId: namespace.environmentId,
        createdAt: namespace.createdAt,
        updatedAt: namespace.updatedAt,
        storedKeys: namespace._count.entries,
        activeKeys: await prisma.storageEntry.count({
          where: {
            namespaceId: namespace.id,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        }),
        expiredKeys: await prisma.storageEntry.count({
          where: { namespaceId: namespace.id, expiresAt: { lte: now } },
        }),
      })),
    ),
  };
});
app.post("/api/runtime-endpoints/:endpointId/cache/purge", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin"]);
  const { endpointId } = request.params as { endpointId: string };
  const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
  if (!endpoint)
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Runtime endpoint not found",
        requestId: requestId(request),
      },
    });
  const input = parse(cachePurgeSchema, request.body);
  if (input.confirmEndpointSlug !== endpoint.slug)
    return reply.status(400).send({
      error: {
        code: "CONFIRMATION_MISMATCH",
        message: "Type the exact endpoint slug to confirm cache purge",
        requestId: requestId(request),
      },
    });
  const purgedKeys = await purgeFunctionCache(
    session.projectId,
    endpoint.environmentId,
  );
  await writeControlAudit(
    session,
    endpointId,
    "function_cache.purged",
    "runtime_endpoint",
    endpointId,
    { purgedKeys },
  );
  return {
    ok: true,
    purgedKeys,
    valuesExposed: false,
    keyMaterialExposed: false,
    purgedAt: new Date(),
  };
});

app.get("/api/functions", async (request) => {
  const session = sessionContext(request);
  const functions = await projectRepository(session.projectId).functions();
  return functions.map((fn) => {
    const endpoints = new Map<
      string,
      {
        endpointId: string;
        endpointName: string;
        endpointKind: "mcp" | "http";
        mcpTools: string[];
        httpRoutes: string[];
        deployedVersion?: number;
        stale: boolean;
      }
    >();
    const usageFor = (endpoint: {
      id: string;
      name: string;
      kind: "mcp" | "http";
      activeDeployment: { snapshot: unknown } | null;
    }) => {
      const existing = endpoints.get(endpoint.id);
      if (existing) return existing;
      const snapshot = record(endpoint.activeDeployment?.snapshot);
      const deployed = Array.isArray(snapshot.functions)
        ? snapshot.functions
            .map(record)
            .find((item) => item.functionId === fn.id)
        : undefined;
      const deployedVersion =
        typeof deployed?.version === "number" ? deployed.version : undefined;
      const usage: {
        endpointId: string;
        endpointName: string;
        endpointKind: "mcp" | "http";
        mcpTools: string[];
        httpRoutes: string[];
        deployedVersion?: number;
        stale: boolean;
      } = {
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        endpointKind: endpoint.kind,
        mcpTools: [],
        httpRoutes: [],
        ...(deployedVersion ? { deployedVersion } : {}),
        stale: deployedVersion !== fn.version,
      };
      endpoints.set(endpoint.id, usage);
      return usage;
    };
    for (const binding of fn.mcpToolBindings) {
      usageFor(binding.endpoint).mcpTools.push(binding.toolName);
    }
    for (const binding of fn.httpRouteBindings) {
      usageFor(binding.endpoint).httpRoutes.push(
        `${binding.method} ${binding.path}`,
      );
    }
    return { ...functionView(fn), usages: [...endpoints.values()] };
  });
});

app.post("/api/functions", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "developer"]);
  const input = parse(functionCreateSchema, request.body);
  const sum = checksum(input.code);
  const secretGrantIds = input.secretGrantIds ?? [];
  const fn = await prisma.$transaction(async (tx) => {
    const created = await tx.function.create({
      data: {
        projectId: session.projectId,
        name: input.name,
        slug: input.slug,
        title: input.title,
        description: input.description,
        code: input.code,
        inputSchema: input.inputSchema,
        outputSchema: input.outputSchema,
        timeoutMs: input.timeoutMs,
        enabled: input.enabled,
        riskLevel: input.riskLevel,
        requiredPermissions: input.requiredPermissions ?? [],
        cachePolicy: input.cachePolicy ?? undefined,
        version: 1,
      } as never,
    });
    await tx.functionVersion.create({
      data: {
        functionId: created.id,
        version: 1,
        code: input.code,
        checksum: sum,
        validationResult: { valid: false, state: "draft" },
        createdByUserId: session.userId,
      },
    });
    if (secretGrantIds.length) {
      const owned = await tx.secret.findMany({
        where: {
          id: { in: secretGrantIds },
          projectId: session.projectId,
        },
        select: { id: true, name: true },
      });
      if (owned.length !== secretGrantIds.length)
        throw Object.assign(
          new Error("One or more secret grant IDs are invalid"),
          { statusCode: 400, code: "INVALID_SECRET_GRANT" },
        );
      const uniqueSecrets = [
        ...new Map(owned.map((secret) => [secret.name, secret])).values(),
      ];
      await tx.secretGrant.createMany({
        data: uniqueSecrets.map((secret) => ({
          functionId: created.id,
          secretId: secret.id,
          secretName: secret.name,
          accessMode: "read",
        })),
      });
    }
    await tx.auditEvent.create({
      data: {
        projectId: session.projectId,
        functionId: created.id,
        actorType: "user",
        actorId: session.userId,
        action: "function.created",
        targetType: "function",
        targetId: created.id,
        metadata: { version: 1, checksum: sum },
      },
    });
    return created;
  });
  const result = await projectRepository(session.projectId).projectFunction(
    fn.id,
  );
  return reply.status(201).send(result ? functionView(result) : fn);
});
app.route({
  method: ["PATCH", "PUT"],
  url: "/api/functions/:functionId",
  handler: async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const { functionId } = request.params as { functionId: string };
    const current = await projectRepository(session.projectId).projectFunction(
      functionId,
    );
    if (!current)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Function not found",
          requestId: requestId(request),
        },
      });
    const input = parse(functionUpdateSchema, request.body);
    const nextVersion = current.version + (input.code === undefined ? 0 : 1);
    await prisma.$transaction(async (tx) => {
      const updated = await tx.function.update({
        where: { id: functionId },
        data: {
          name: input.name,
          slug: input.slug,
          title: input.title,
          description: input.description,
          code: input.code,
          inputSchema: input.inputSchema,
          outputSchema: input.outputSchema,
          timeoutMs: input.timeoutMs,
          enabled: input.enabled,
          riskLevel: input.riskLevel,
          requiredPermissions: input.requiredPermissions,
          cachePolicy: input.cachePolicy,
          version: nextVersion,
        } as never,
      });
      if (input.code !== undefined)
        await tx.functionVersion.create({
          data: {
            functionId,
            version: nextVersion,
            code: input.code,
            checksum: checksum(input.code),
            validationResult: { valid: false, state: "draft" },
            createdByUserId: session.userId,
          },
        });
      if (input.secretGrantIds !== undefined) {
        const owned = await tx.secret.findMany({
          where: {
            id: { in: input.secretGrantIds },
            projectId: session.projectId,
          },
          select: { id: true, name: true },
        });
        if (owned.length !== input.secretGrantIds.length)
          throw Object.assign(
            new Error("One or more secret grant IDs are invalid"),
            { statusCode: 400, code: "INVALID_SECRET_GRANT" },
          );
        await tx.secretGrant.deleteMany({ where: { functionId } });
        if (owned.length) {
          const uniqueSecrets = [
            ...new Map(owned.map((secret) => [secret.name, secret])).values(),
          ];
          await tx.secretGrant.createMany({
            data: uniqueSecrets.map((secret) => ({
              functionId,
              secretId: secret.id,
              secretName: secret.name,
              accessMode: "read",
            })),
          });
        }
      }
      await tx.auditEvent.create({
        data: {
          projectId: session.projectId,
          functionId,
          actorType: "user",
          actorId: session.userId,
          action: "function.updated",
          targetType: "function",
          targetId: functionId,
          metadata: {
            version: nextVersion,
            ...(input.secretGrantIds
              ? { secretGrantCount: input.secretGrantIds.length }
              : {}),
          },
        },
      });
      return updated;
    });
    const result = await projectRepository(session.projectId).projectFunction(
      functionId,
    );
    return result
      ? functionView(result)
      : reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Function not found",
            requestId: requestId(request),
          },
        });
  },
});
app.get("/api/functions/:functionId", async (request, reply) => {
  const session = sessionContext(request);
  const { functionId } = request.params as { functionId: string };
  const fn = await projectRepository(session.projectId).projectFunction(
    functionId,
  );
  return fn
    ? functionView(fn)
    : reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Function not found",
          requestId: requestId(request),
        },
      });
});
app.get("/api/functions/:functionId/fixtures", async (request, reply) => {
  const session = sessionContext(request);
  const { functionId } = request.params as { functionId: string };
  const fn = await projectRepository(session.projectId).projectFunction(
    functionId,
  );
  if (!fn)
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Function not found",
        requestId: requestId(request),
      },
    });
  const validation = record(fn.versions[0]?.validationResult);
  const fixtureSet = record(validation.fixtures);
  const items = Array.isArray(fixtureSet.items) ? fixtureSet.items : [];
  return redactSensitive({
    version: typeof fixtureSet.version === "number" ? fixtureSet.version : 1,
    items,
  });
});
app.post("/api/functions/:functionId/validate", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "developer"]);
  const { functionId } = request.params as { functionId: string };
  if (
    functionId !== "new" &&
    !(await projectRepository(session.projectId).projectFunction(functionId))
  )
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Function not found",
        requestId: requestId(request),
      },
    });
  try {
    const draft = parse(functionCreateSchema, request.body);
    const ajv = new Ajv({ allErrors: true, strict: false });
    ajv.compile(draft.inputSchema);
    ajv.compile(draft.outputSchema);
    const libraries = await prisma.projectLibrary.findMany({
      where: { projectId: session.projectId },
      orderBy: { version: "desc" },
      distinct: ["importPath"],
    });
    const result = await bundleFunction({
      code: draft.code,
      projectLibraries: libraries.map((library) => ({
        importPath: library.importPath,
        code: library.code,
        version: library.version,
      })),
    });
    return {
      valid: true,
      diagnostics: [],
      checksum: result.checksum,
      imports: result.imports,
    };
  } catch (error) {
    return {
      valid: false,
      diagnostics: [
        {
          message: error instanceof Error ? error.message : "Validation failed",
        },
      ],
    };
  }
});
app.post("/api/functions/:functionId/test", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "developer", "operator"]);
  const { functionId } = request.params as { functionId: string };
  if (functionId === "new")
    return reply.status(409).send({
      error: {
        code: "DRAFT_NOT_SAVED",
        message:
          "Save the Function to development before testing it.",
        requestId: requestId(request),
      },
    });
  const fn = await projectRepository(session.projectId).projectFunction(
    functionId,
  );
  if (!fn)
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Function not found",
        requestId: requestId(request),
      },
    });
  const body = parse(testInvocationSchema, request.body);
  const endpoint = await prisma.runtimeEndpoint.findFirst({
    where: {
      projectId: session.projectId,
      activeDeploymentId: { not: null },
      environment: { slug: "development" },
      ...(body.endpointId ? { id: body.endpointId } : {}),
    },
    select: { id: true },
  });
  if (!endpoint)
    return reply.status(409).send({
      error: {
        code: "DEVELOPMENT_RUNTIME_UNAVAILABLE",
        message:
          "Deploy the Project to development once, then select a development endpoint for runtime capabilities.",
        requestId: requestId(request),
      },
    });

  const availableFunctions = await prisma.function.findMany({
    where: { projectId: session.projectId, enabled: true },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1 },
      grants: true,
    },
    orderBy: { name: "asc" },
  });
  const { functions: selectedFunctions, calls } = resolveFunctionCallGraph(
    availableFunctions,
    new Set([functionId]),
  );
  const libraries = await prisma.projectLibrary.findMany({
    where: { projectId: session.projectId },
    orderBy: { version: "desc" },
    distinct: ["importPath"],
  });
  const snapshotFunctions = await Promise.all(
    selectedFunctions.map(async (item) => {
      const version = item.versions[0];
      if (!version)
        throw Object.assign(
          new Error(`Function ${item.name} has no saved development version`),
          { statusCode: 409, code: "FUNCTION_NOT_SAVED" },
        );
      const built = await bundleFunction({
        code: version.code,
        projectLibraries: libraries.map((library) => ({
          importPath: library.importPath,
          code: library.code,
          version: library.version,
        })),
      });
      return {
        id: item.id,
        functionId: item.id,
        versionId: version.id,
        version: version.version,
        name: item.name,
        slug: item.slug,
        enabled: item.enabled,
        riskLevel: item.riskLevel,
        requiredPermissions: item.requiredPermissions,
        secretGrants: item.grants.map((grant) => grant.secretName),
        timeoutMs: item.timeoutMs,
        inputSchema: item.inputSchema,
        outputSchema: item.outputSchema,
        cachePolicy: item.cachePolicy,
        compiledCode: built.compiledCode,
      };
    }),
  );
  const base = process.env.RUNTIME_INTERNAL_URL ?? "http://localhost:8080";
  const response = await fetch(
    `${base}/internal/runtime-endpoints/${endpoint.id}/functions/${functionId}/test`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.INTERNAL_API_TOKEN
          ? { "x-internal-token": process.env.INTERNAL_API_TOKEN }
          : {}),
      },
      body: JSON.stringify({
        ...body,
        savedDevelopmentSnapshot: { functions: snapshotFunctions, calls },
      }),
      signal: AbortSignal.timeout(125_000),
    },
  );
  const result = await response.json();
  return reply.status(response.status).send(result);
});

app.post("/api/runtime-endpoints/:endpointId/mcp-bindings", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "developer"]);
  const { endpointId } = request.params as { endpointId: string };
  const input = parse(mcpBindingSchema, request.body);
  await validateBindingReferences(
    session.projectId,
    endpointId,
    input.functionId,
    "mcp",
  );
  if (
    await prisma.mcpToolBinding.findFirst({
      where: { endpointId, toolName: input.toolName },
      select: { id: true },
    })
  )
    return reply.status(409).send({
      error: {
        code: "MCP_TOOL_NAME_CONFLICT",
        message: "This MCP tool name is already bound in the endpoint",
        requestId: requestId(request),
      },
    });
  const created = await prisma.mcpToolBinding.create({
    data: { endpointId, ...input },
  });
  await writeControlAudit(
    session,
    endpointId,
    "mcp_binding.created",
    "mcp_tool_binding",
    created.id,
    { toolName: created.toolName, functionId: created.functionId },
  );
  return reply.status(201).send(created);
});
app.post("/api/runtime-endpoints/:endpointId/http-bindings", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "developer"]);
  const { endpointId } = request.params as { endpointId: string };
  const input = parse(httpBindingSchema, request.body);
  await validateBindingReferences(
    session.projectId,
    endpointId,
    input.functionId,
    "http",
  );
  if (
    await prisma.httpRouteBinding.findFirst({
      where: { endpointId, method: input.method, path: input.path },
      select: { id: true },
    })
  )
    return reply.status(409).send({
      error: {
        code: "HTTP_ROUTE_CONFLICT",
        message: "This HTTP method and path are already bound in the endpoint",
        requestId: requestId(request),
      },
    });
  const created = await prisma.httpRouteBinding.create({
    data: { endpointId, ...input } as never,
  });
  await writeControlAudit(
    session,
    endpointId,
    "http_binding.created",
    "http_route_binding",
    created.id,
    {
      method: created.method,
      path: created.path,
      functionId: created.functionId,
    },
  );
  return reply.status(201).send(created);
});
app.patch(
  "/api/runtime-endpoints/:endpointId/mcp-bindings/:bindingId",
  async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const { endpointId, bindingId } = request.params as {
      endpointId: string;
      bindingId: string;
    };
    const input = parse(mcpBindingSchema.partial().strict(), request.body);
    const owned = await prisma.mcpToolBinding.findFirst({
      where: {
        id: bindingId,
        endpoint: { id: endpointId, projectId: session.projectId },
      },
    });
    if (!owned)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Binding not found",
          requestId: requestId(request),
        },
      });
    await validateBindingReferences(
      session.projectId,
      endpointId,
      input.functionId ?? owned.functionId,
      "mcp",
    );
    const toolName = input.toolName ?? owned.toolName;
    if (
      await prisma.mcpToolBinding.findFirst({
        where: { endpointId, toolName, id: { not: bindingId } },
        select: { id: true },
      })
    )
      return reply.status(409).send({
        error: {
          code: "MCP_TOOL_NAME_CONFLICT",
          message: "This MCP tool name is already bound in the endpoint",
          requestId: requestId(request),
        },
      });
    const updated = await prisma.mcpToolBinding.update({
      where: { id: bindingId },
      data: input,
    });
    await writeControlAudit(
      session,
      endpointId,
      "mcp_binding.updated",
      "mcp_tool_binding",
      bindingId,
      { toolName: updated.toolName, functionId: updated.functionId },
    );
    return updated;
  },
);
app.patch(
  "/api/runtime-endpoints/:endpointId/http-bindings/:bindingId",
  async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const { endpointId, bindingId } = request.params as {
      endpointId: string;
      bindingId: string;
    };
    const input = parse(httpBindingSchema.partial().strict(), request.body);
    const owned = await prisma.httpRouteBinding.findFirst({
      where: {
        id: bindingId,
        endpoint: { id: endpointId, projectId: session.projectId },
      },
    });
    if (!owned)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Binding not found",
          requestId: requestId(request),
        },
      });
    await validateBindingReferences(
      session.projectId,
      endpointId,
      input.functionId ?? owned.functionId,
      "http",
    );
    const method = input.method ?? owned.method;
    const path = input.path ?? owned.path;
    if (
      await prisma.httpRouteBinding.findFirst({
        where: { endpointId, method, path, id: { not: bindingId } },
        select: { id: true },
      })
    )
      return reply.status(409).send({
        error: {
          code: "HTTP_ROUTE_CONFLICT",
          message: "This HTTP method and path are already bound in the endpoint",
          requestId: requestId(request),
        },
      });
    const updated = await prisma.httpRouteBinding.update({
      where: { id: bindingId },
      data: input as never,
    });
    await writeControlAudit(
      session,
      endpointId,
      "http_binding.updated",
      "http_route_binding",
      bindingId,
      {
        method: updated.method,
        path: updated.path,
        functionId: updated.functionId,
      },
    );
    return updated;
  },
);
app.delete(
  "/api/runtime-endpoints/:endpointId/mcp-bindings/:bindingId",
  async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const { endpointId, bindingId } = request.params as {
      endpointId: string;
      bindingId: string;
    };
    const owned = await prisma.mcpToolBinding.findFirst({
      where: {
        id: bindingId,
        endpoint: { id: endpointId, projectId: session.projectId },
      },
    });
    if (!owned)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Binding not found",
          requestId: requestId(request),
        },
      });
    await prisma.mcpToolBinding.delete({ where: { id: bindingId } });
    await writeControlAudit(
      session,
      endpointId,
      "mcp_binding.deleted",
      "mcp_tool_binding",
      bindingId,
      { toolName: owned.toolName },
    );
    return reply.status(204).send();
  },
);
app.delete(
  "/api/runtime-endpoints/:endpointId/http-bindings/:bindingId",
  async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const { endpointId, bindingId } = request.params as {
      endpointId: string;
      bindingId: string;
    };
    const owned = await prisma.httpRouteBinding.findFirst({
      where: {
        id: bindingId,
        endpoint: { id: endpointId, projectId: session.projectId },
      },
    });
    if (!owned)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Binding not found",
          requestId: requestId(request),
        },
      });
    await prisma.httpRouteBinding.delete({ where: { id: bindingId } });
    await writeControlAudit(
      session,
      endpointId,
      "http_binding.deleted",
      "http_route_binding",
      bindingId,
      { method: owned.method, path: owned.path },
    );
    return reply.status(204).send();
  },
);

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
app.post("/api/runtime-endpoints/:endpointId/auth-policies", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin"]);
  const { endpointId } = request.params as { endpointId: string };
  const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
  if (!endpoint)
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Runtime endpoint not found",
        requestId: requestId(request),
      },
    });
  const input = parse(authPolicyMutationSchema, request.body);
  await validatePolicySecretIfRequired(
    session.projectId,
    endpoint.environmentId,
    input.config,
  );
  if (
    await prisma.authPolicy.findFirst({
      where: { projectId: session.projectId, name: input.name },
      select: { id: true },
    })
  )
    return reply.status(409).send({
      error: {
        code: "AUTH_POLICY_NAME_CONFLICT",
        message: "An authentication policy with this name already exists",
        requestId: requestId(request),
      },
    });
  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.authPolicy.create({
      data: { projectId: session.projectId, ...input } as never,
    });
    await tx.runtimeEndpoint.update({
      where: { id: endpointId },
      data: { defaultAuthPolicyId: created.id },
    });
    await tx.auditEvent.create({
      data: {
        projectId: session.projectId,
        endpointId,
        actorType: "user",
        actorId: session.userId,
        action: "auth_policy.created",
        targetType: "auth_policy",
        targetId: created.id,
        metadata: { name: created.name, type: created.type },
      },
    });
    return created;
  });
  return reply.status(201).send(policyView(result));
});
app.patch(
  "/api/runtime-endpoints/:endpointId/auth-policies/:policyId",
  async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { endpointId, policyId } = request.params as {
      endpointId: string;
      policyId: string;
    };
    const endpoint = await projectRepository(session.projectId).endpoint(
      endpointId,
    );
    if (!endpoint)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Runtime endpoint not found",
          requestId: requestId(request),
        },
      });
    const owned = await prisma.authPolicy.findFirst({
      where: {
        id: policyId,
        projectId: session.projectId,
        defaultEndpoints: { some: { id: endpointId } },
      },
    });
    if (!owned)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Authentication policy not found for this endpoint",
          requestId: requestId(request),
        },
      });
    const input = parse(authPolicyMutationSchema, request.body);
    await validatePolicySecretIfRequired(
      session.projectId,
      endpoint.environmentId,
      input.config,
    );
    if (
      await prisma.authPolicy.findFirst({
        where: {
          projectId: session.projectId,
          name: input.name,
          id: { not: policyId },
        },
        select: { id: true },
      })
    )
      return reply.status(409).send({
        error: {
          code: "AUTH_POLICY_NAME_CONFLICT",
          message: "An authentication policy with this name already exists",
          requestId: requestId(request),
        },
      });
    const updated = await prisma.authPolicy.update({
      where: { id: policyId },
      data: input as never,
    });
    await writeControlAudit(
      session,
      endpointId,
      "auth_policy.updated",
      "auth_policy",
      policyId,
      { name: updated.name, type: updated.type },
    );
    return policyView(updated);
  },
);
app.post(
  "/api/runtime-endpoints/:endpointId/auth-policies/:policyId/default",
  async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { endpointId, policyId } = request.params as {
      endpointId: string;
      policyId: string;
    };
    const [endpoint, policy] = await Promise.all([
      prisma.runtimeEndpoint.findFirst({
        where: { id: endpointId, projectId: session.projectId },
      }),
      prisma.authPolicy.findFirst({
        where: { id: policyId, projectId: session.projectId },
      }),
    ]);
    if (!endpoint || !policy)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Runtime endpoint or authentication policy not found",
          requestId: requestId(request),
        },
      });
    await validatePolicySecretIfRequired(
      session.projectId,
      endpoint.environmentId,
      record(policy.config),
    );
    await prisma.runtimeEndpoint.update({
      where: { id: endpointId },
      data: { defaultAuthPolicyId: policyId },
    });
    await writeControlAudit(
      session,
      endpointId,
      "auth_policy.default_changed",
      "auth_policy",
      policyId,
      { name: policy.name, type: policy.type },
    );
    return { ok: true, defaultAuthPolicyId: policyId };
  },
);
app.delete(
  "/api/runtime-endpoints/:endpointId/auth-policies/:policyId",
  async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { endpointId, policyId } = request.params as {
      endpointId: string;
      policyId: string;
    };
    const policy = await prisma.authPolicy.findFirst({
      where: { id: policyId, projectId: session.projectId },
      include: {
        _count: { select: { defaultEndpoints: true } },
      },
    });
    if (!policy)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Authentication policy not found",
          requestId: requestId(request),
        },
      });
    if (policy._count.defaultEndpoints)
      return reply.status(409).send({
        error: {
          code: "AUTH_POLICY_IN_USE",
          message:
            "Reassign runtime endpoints before deleting this policy",
          requestId: requestId(request),
        },
      });
    await prisma.authPolicy.delete({ where: { id: policyId } });
    await writeControlAudit(
      session,
      endpointId,
      "auth_policy.deleted",
      "auth_policy",
      policyId,
      { name: policy.name, type: policy.type },
    );
    return reply.status(204).send();
  },
);
app.get("/api/auth-policies", async (request) => {
  const session = sessionContext(request);
  return prisma.authPolicy
    .findMany({
      where: { projectId: session.projectId },
      orderBy: { name: "asc" },
    })
    .then((policies) => policies.map(policyView));
});
app.get("/api/auth-policy-providers", async () =>
  [
    "public",
    "api_key",
    "bearer_token",
    "basic_auth",
    "jwt",
    "oidc",
    "entra_id",
    "webhook_signature",
  ].map((type) => ({ type, status: providerStatus(type) })),
);
app.get("/api/libraries", async (request) => {
  const session = sessionContext(request);
  const rows = await prisma.projectLibrary.findMany({
    where: { projectId: session.projectId },
    orderBy: [{ importPath: "asc" }, { version: "desc" }],
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows)
    if (!latest.has(row.importPath)) latest.set(row.importPath, row);
  return [...latest.values()].map((row) => ({
    ...row,
    importExample: `import { ${Array.isArray(row.exportedFunctions) && typeof row.exportedFunctions[0] === "string" ? row.exportedFunctions[0] : "utility"} } from ${JSON.stringify(row.importPath)};`,
    versionCount: rows.filter(
      (candidate) => candidate.importPath === row.importPath,
    ).length,
  }));
});
app.get("/api/libraries/:libraryId/versions", async (request, reply) => {
  const session = sessionContext(request);
  const { libraryId } = request.params as { libraryId: string };
  const library = await prisma.projectLibrary.findFirst({
    where: { id: libraryId, projectId: session.projectId },
    select: { importPath: true },
  });
  if (!library)
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Library not found",
        requestId: requestId(request),
      },
    });
  return prisma.projectLibrary.findMany({
    where: { projectId: session.projectId, importPath: library.importPath },
    orderBy: { version: "desc" },
  });
});
app.post("/api/libraries", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "developer"]);
  const parsed = parse(projectLibrarySchema, request.body);
  const input = {
    ...parsed,
    description: parsed.description ?? "",
    exportedFunctions: parsed.exportedFunctions ?? [],
  };
  await validateProjectLibrary(input.importPath, input.code);
  const latest = await prisma.projectLibrary.aggregate({
    where: { projectId: session.projectId, importPath: input.importPath },
    _max: { version: true },
  });
  const created = await prisma.projectLibrary.create({
    data: {
      projectId: session.projectId,
      ...input,
      version: (latest._max.version ?? 0) + 1,
    },
  });
  await prisma.auditEvent.create({
    data: {
      projectId: session.projectId,
      actorType: "user",
      actorId: session.userId,
      action: "project_library.version_created",
      targetType: "project_library",
      targetId: created.id,
      metadata: {
        name: created.name,
        importPath: created.importPath,
        version: created.version,
        exportedFunctions: created.exportedFunctions,
      },
    },
  });
  return reply.status(201).send(created);
});
app.get("/api/templates", async () => functionTemplates);
app.post("/api/templates/install", async (request, reply) => {
  sessionContext(request);
  return reply.status(410).send({
    error: {
      code: "ENDPOINT_RETIRED",
      message: "Use the endpoint-scoped template preview and install endpoints.",
      requestId: requestId(request),
    },
  });
});
app.post(
  "/api/runtime-endpoints/:endpointId/templates/:templateId/preview",
  async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const { endpointId, templateId } = request.params as {
      endpointId: string;
      templateId: string;
    };
    const selection = parse(templateInstallSelectionSchema, request.body ?? {});
    const loaded = await loadTemplateInstallContext(
      session.projectId,
      endpointId,
      templateId,
    );
    if (!loaded)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Runtime endpoint or template not found",
          requestId: requestId(request),
        },
      });
    return previewTemplateInstallation(
      loaded.template,
      selection,
      loaded.context,
    );
  },
);

app.post(
  "/api/runtime-endpoints/:endpointId/templates/:templateId/install",
  async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const { endpointId, templateId } = request.params as {
      endpointId: string;
      templateId: string;
    };
    const selection = parse(templateInstallSelectionSchema, request.body ?? {});
    const loaded = await loadTemplateInstallContext(
      session.projectId,
      endpointId,
      templateId,
    );
    if (!loaded)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Runtime endpoint or template not found",
          requestId: requestId(request),
        },
      });
    const existing = await prisma.function.findFirst({
      where: { projectId: session.projectId, slug: loaded.template.id },
      select: { id: true },
    });
    if (existing)
      return reply.status(409).send({
        error: {
          code: "ALREADY_EXISTS",
          message: "This template is already installed",
          requestId: requestId(request),
        },
      });
    const preview = previewTemplateInstallation(
      loaded.template,
      selection,
      loaded.context,
    );
    if (!preview.installable)
      return reply.status(422).send({
        error: {
          code: "TEMPLATE_CONFIGURATION_REQUIRED",
          message: "Template requirements are not satisfied.",
          requestId: requestId(request),
        },
        preview,
      });
    const template = loaded.template;
    const selectedSecrets = template.secrets
      .map((name) => ({ name, id: selection.secretGrants[name] }))
      .filter(
        (secret): secret is { name: string; id: string } =>
          typeof secret.id === "string",
      );
    const fn = await prisma.$transaction(async (tx) => {
      const created = await tx.function.create({
        data: {
          projectId: session.projectId,
          name: template.id.replaceAll("-", "_"),
          slug: template.id,
          title: template.name,
          description: template.description,
          code: template.code,
          inputSchema: template.inputSchema,
          outputSchema: template.outputSchema,
          timeoutMs: 30_000,
          enabled: preview.enabledAfterInstall,
          riskLevel: template.riskLevel,
          requiredPermissions: template.permissions,
          version: 1,
        } as never,
      });
      await tx.functionVersion.create({
        data: {
          functionId: created.id,
          version: 1,
          code: template.code,
          checksum: checksum(template.code),
          validationResult: {
            valid: false,
            state: "template_draft",
            templateId,
            fixtures: template.fixtures,
            documentation: template.documentation,
            availability: template.availability,
          },
          createdByUserId: session.userId,
        } as never,
      });
      if (selectedSecrets.length)
        await tx.secretGrant.createMany({
          data: selectedSecrets.map((secret) => ({
            functionId: created.id,
            secretId: secret.id,
            secretName: secret.name,
            accessMode: "read",
          })),
        });
      if (template.bindings.mcp && loaded.endpoint.kind === "mcp")
        await tx.mcpToolBinding.create({
          data: {
            endpointId,
            functionId: created.id,
            toolName: template.bindings.mcp,
            title: template.name,
            description: template.description,
            enabled: preview.enabledAfterInstall,
          },
        });
      if (template.bindings.http && loaded.endpoint.kind === "http")
        await tx.httpRouteBinding.create({
          data: {
            endpointId,
            functionId: created.id,
            method: template.bindings.http.method as never,
            path: template.bindings.http.path,
            enabled: preview.enabledAfterInstall,
          },
        });
      await tx.auditEvent.create({
        data: {
          projectId: session.projectId,
          environmentId: loaded.endpoint.environmentId,
          endpointId,
          functionId: created.id,
          actorType: "user",
          actorId: session.userId,
          action: "template.installed",
          targetType: "function",
          targetId: created.id,
          metadata: {
            templateId,
            enabled: preview.enabledAfterInstall,
            secretReferences: template.secrets,
            bindingTypes: Object.keys(template.bindings),
            networkPolicyMutated: false,
          },
        },
      });
      if (template.id === "webhook" && selection.authPolicyId)
        await tx.runtimeEndpoint.update({
          where: { id: endpointId },
          data: { defaultAuthPolicyId: selection.authPolicyId },
        });
      return created;
    });
    return reply
      .status(201)
      .send({ function: fn, enabled: fn.enabled, preview, template });
  },
);
app.post("/api/runtime-endpoints/:endpointId/disable", async (request) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "operator"]);
  const { endpointId } = request.params as { endpointId: string };
  return setEndpointEnabled(session, endpointId, false);
});
app.post("/api/runtime-endpoints/:endpointId/enable", async (request) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "operator"]);
  const { endpointId } = request.params as { endpointId: string };
  return setEndpointEnabled(session, endpointId, true);
});
app.post("/api/runtime-endpoints/:endpointId/status", async (request) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "operator"]);
  const { endpointId } = request.params as { endpointId: string };
  const { status } = parse(endpointStatusSchema, request.body);
  return setEndpointEnabled(session, endpointId, status === "enabled");
});

const projectReleaseSchema = z.object({
  sourceProjectDeploymentId: z.string().uuid(),
});

app.post("/api/deployments", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "developer", "operator"]);
  const environment = await prisma.environment.findFirst({
    where: { projectId: session.projectId, slug: "development" },
  });
  if (!environment)
    return reply.status(409).send({
      error: {
        code: "DEVELOPMENT_ENVIRONMENT_REQUIRED",
        message: "Create the development environment before deploying.",
        requestId: requestId(request),
      },
    });
  const endpoints = await prisma.runtimeEndpoint.findMany({
    where: {
      projectId: session.projectId,
      environmentId: environment.id,
      status: { not: "disabled" },
    },
    include: { activeDeployment: true, networkPolicy: true },
    orderBy: [{ kind: "asc" }, { slug: "asc" }],
  });
  if (!endpoints.length)
    return reply.status(409).send({
      error: {
        code: "NO_RUNTIME_ENDPOINTS",
        message: "Add an MCP Endpoint or HTTP API before deploying.",
        requestId: requestId(request),
      },
    });
  const latestProject = await prisma.projectDeployment.aggregate({
    where: { projectId: session.projectId, environmentId: environment.id },
    _max: { version: true },
  });
  const endpointVersions = new Map<string, number>();
  for (const endpoint of endpoints) {
    const latest = await prisma.deployment.aggregate({
      where: { endpointId: endpoint.id },
      _max: { version: true },
    });
    endpointVersions.set(endpoint.id, (latest._max.version ?? 0) + 1);
  }
  const created = await prisma.$transaction(async (tx) => {
    const projectDeployment = await tx.projectDeployment.create({
      data: {
        projectId: session.projectId,
        environmentId: environment.id,
        version: (latestProject._max.version ?? 0) + 1,
        status: "queued",
      },
    });
    const childDeployments = [];
    for (const endpoint of endpoints) {
      const endpointConfig = record(endpoint.runtimeConfig);
      const activeConfig = record(endpoint.activeDeployment?.runtimeConfig);
      const activeSnapshot = record(endpoint.activeDeployment?.snapshot);
      const runtimeConfig = deploymentRuntimeConfigSchema.parse({
        env: record(
          endpointConfig.env ?? activeConfig.env ?? activeSnapshot.env,
        ),
        endpointAccessPolicy: record(
          endpointConfig.endpointAccessPolicy ??
            activeConfig.endpointAccessPolicy ??
            activeSnapshot.endpointAccessPolicy,
        ),
        network: endpoint.networkPolicy
          ? {
              allowPrivateHosts: stringList(
                endpoint.networkPolicy.allowPrivateHosts,
              ),
            }
          : {
              allowPrivateHosts: stringList(
                record(activeConfig.network).allowPrivateHosts ??
                  record(activeSnapshot.networkPolicy).allowPrivateHosts,
              ),
            },
      });
      const child = await tx.deployment.create({
        data: {
          endpointId: endpoint.id,
          projectDeploymentId: projectDeployment.id,
          version: endpointVersions.get(endpoint.id) as number,
          status: "queued",
          snapshot: {},
          runtimeConfig: {
            ...runtimeConfig,
            timeoutMs: numericSetting(endpointConfig.timeoutMs, 30_000),
            maxConcurrentRequests: numericSetting(
              endpointConfig.maxConcurrentRequests,
              20,
            ),
            requestedBy: session.userId,
          },
          checksum: "pending",
        },
      });
      await tx.deploymentLog.create({
        data: {
          deploymentId: child.id,
          level: "info",
          message: "Project development deployment queued",
          metadata: { projectDeploymentId: projectDeployment.id },
        },
      });
      childDeployments.push(child);
    }
    await tx.auditEvent.create({
      data: {
        projectId: session.projectId,
        environmentId: environment.id,
        actorType: "user",
        actorId: session.userId,
        action: "project_deployment.queued",
        targetType: "project_deployment",
        targetId: projectDeployment.id,
        metadata: { version: projectDeployment.version },
      },
    });
    return { projectDeployment, childDeployments };
  });
  for (const deployment of created.childDeployments)
    await deploymentQueue.add(
      "build",
      {
        deploymentId: deployment.id,
        projectId: session.projectId,
        actorId: session.userId,
      },
      {
        jobId: deployment.id,
        attempts: 2,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  return reply.status(202).send({
    ...created.projectDeployment,
    endpointCount: created.childDeployments.length,
  });
});

app.post("/api/deployments/release", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "operator"]);
  const { sourceProjectDeploymentId } = parse(
    projectReleaseSchema,
    request.body,
  );
  const source = await prisma.projectDeployment.findFirst({
    where: {
      id: sourceProjectDeploymentId,
      projectId: session.projectId,
      status: { in: ["active", "rolled_back"] },
      environment: { slug: "development" },
    },
    include: {
      endpointDeployments: { include: { endpoint: true } },
    },
  });
  if (!source)
    return reply.status(409).send({
      error: {
        code: "INVALID_RELEASE_SOURCE",
        message: "Select a completed development deployment.",
        requestId: requestId(request),
      },
    });
  const production = await prisma.environment.findFirst({
    where: { projectId: session.projectId, slug: "production" },
    include: { activeProjectDeployment: true },
  });
  if (!production)
    return reply.status(409).send({
      error: {
        code: "PRODUCTION_ENVIRONMENT_REQUIRED",
        message: "Create the production environment before releasing.",
        requestId: requestId(request),
      },
    });
  const productionSecrets = await prisma.secret.findMany({
    where: { projectId: session.projectId, environmentId: production.id },
    select: { id: true, name: true },
  });
  const productionConnections = await prisma.databaseConnection.findMany({
    where: {
      projectId: session.projectId,
      environmentId: production.id,
      enabled: true,
    },
    select: { id: true, name: true, secretId: true },
  });
  const connectionByName = new Map(
    productionConnections.map((connection) => [connection.name, connection]),
  );
  const secretNames = new Set(productionSecrets.map((secret) => secret.name));
  const requiredSecrets = new Set<string>();
  for (const deployment of source.endpointDeployments) {
    const snapshot = record(deployment.snapshot);
    for (const fn of arrayRecords(snapshot.functions))
      for (const name of stringList(fn.secretGrants)) requiredSecrets.add(name);
    for (const policy of arrayRecords(snapshot.authPolicies)) {
      const secretRef = record(policy.config).secretRef;
      if (typeof secretRef === "string") requiredSecrets.add(secretRef);
    }
    for (const query of arrayRecords(snapshot.reviewedQueries)) {
      const connection = record(query.connection);
      const name = typeof connection.name === "string" ? connection.name : "";
      if (name && !connectionByName.has(name))
        return reply.status(409).send({
          error: {
            code: "PRODUCTION_CONFIGURATION_INCOMPLETE",
            message: `Production is missing reviewed database connection '${name}'.`,
            requestId: requestId(request),
          },
        });
    }
  }
  const missingSecrets = [...requiredSecrets].filter(
    (name) => !secretNames.has(name),
  );
  if (missingSecrets.length)
    return reply.status(409).send({
      error: {
        code: "PRODUCTION_CONFIGURATION_INCOMPLETE",
        message: `Production is missing required secrets: ${missingSecrets.join(", ")}`,
        requestId: requestId(request),
      },
    });
  const latest = await prisma.projectDeployment.aggregate({
    where: { projectId: session.projectId, environmentId: production.id },
    _max: { version: true },
  });
  const result = await prisma.$transaction(async (tx) => {
    if (production.activeProjectDeploymentId) {
      await tx.projectDeployment.update({
        where: { id: production.activeProjectDeploymentId },
        data: { status: "rolled_back" },
      });
      await tx.deployment.updateMany({
        where: { projectDeploymentId: production.activeProjectDeploymentId },
        data: { status: "rolled_back" },
      });
    }
    const projectDeployment = await tx.projectDeployment.create({
      data: {
        projectId: session.projectId,
        environmentId: production.id,
        sourceProjectDeploymentId: source.id,
        version: (latest._max.version ?? 0) + 1,
        status: "active",
        completedAt: new Date(),
      },
    });
    const artifacts = [];
    for (const sourceDeployment of source.endpointDeployments) {
      const latestEndpoint = await tx.deployment.aggregate({
        where: { endpointId: sourceDeployment.endpointId },
        _max: { version: true },
      });
      const promotedSnapshot = promoteEndpointSnapshot(
        sourceDeployment.snapshot,
        production,
        connectionByName,
      );
      const promotedChecksum = checksum(canonicalJson(promotedSnapshot));
      const deployment = await tx.deployment.create({
        data: {
          endpointId: sourceDeployment.endpointId,
          projectDeploymentId: projectDeployment.id,
          version: (latestEndpoint._max.version ?? 0) + 1,
          status: "active",
          snapshot: promotedSnapshot as never,
          runtimeConfig: {
            ...record(sourceDeployment.runtimeConfig),
            env: record(production.variables),
          } as never,
          checksum: promotedChecksum,
          completedAt: new Date(),
        },
      });
      artifacts.push({
        endpointId: sourceDeployment.endpointId,
        deploymentId: deployment.id,
        version: deployment.version,
        checksum: promotedChecksum,
        endpoint: {
          id: sourceDeployment.endpoint.id,
          name: sourceDeployment.endpoint.name,
          slug: sourceDeployment.endpoint.slug,
          kind: sourceDeployment.endpoint.kind,
        },
        snapshot: promotedSnapshot,
      });
    }
    const projectSnapshot = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      projectId: session.projectId,
      environmentId: production.id,
      sourceProjectDeploymentId: source.id,
      endpoints: artifacts,
    };
    const projectChecksum = checksum(canonicalJson(projectSnapshot));
    await tx.projectDeployment.update({
      where: { id: projectDeployment.id },
      data: { snapshot: projectSnapshot as never, checksum: projectChecksum },
    });
    await tx.environment.update({
      where: { id: production.id },
      data: { activeProjectDeploymentId: projectDeployment.id },
    });
    await tx.auditEvent.create({
      data: {
        projectId: session.projectId,
        environmentId: production.id,
        actorType: "user",
        actorId: session.userId,
        action: "project_release.activated",
        targetType: "project_deployment",
        targetId: projectDeployment.id,
        metadata: {
          version: projectDeployment.version,
          sourceProjectDeploymentId: source.id,
          checksum: projectChecksum,
        },
      },
    });
    return { ...projectDeployment, snapshot: projectSnapshot, checksum: projectChecksum };
  });
  return reply.status(201).send(result);
});

app.post("/api/deployments/:projectDeploymentId/rollback", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "operator"]);
  const { projectDeploymentId } = request.params as {
    projectDeploymentId: string;
  };
  const target = await prisma.projectDeployment.findFirst({
    where: {
      id: projectDeploymentId,
      projectId: session.projectId,
      status: "rolled_back",
    },
    include: {
      environment: true,
      endpointDeployments: true,
    },
  });
  if (!target)
    return reply.status(409).send({
      error: {
        code: "INVALID_ROLLBACK_TARGET",
        message: "Select a completed previous project deployment.",
        requestId: requestId(request),
      },
    });
  await prisma.$transaction(async (tx) => {
    if (target.environment.activeProjectDeploymentId) {
      await tx.projectDeployment.update({
        where: { id: target.environment.activeProjectDeploymentId },
        data: { status: "rolled_back" },
      });
      await tx.deployment.updateMany({
        where: {
          projectDeploymentId: target.environment.activeProjectDeploymentId,
        },
        data: { status: "rolled_back" },
      });
    }
    await tx.projectDeployment.update({
      where: { id: target.id },
      data: { status: "active" },
    });
    await tx.deployment.updateMany({
      where: { projectDeploymentId: target.id },
      data: { status: "active" },
    });
    await tx.environment.update({
      where: { id: target.environmentId },
      data: { activeProjectDeploymentId: target.id },
    });
    if (target.environment.slug === "development")
      for (const deployment of target.endpointDeployments)
        await tx.runtimeEndpoint.update({
          where: { id: deployment.endpointId },
          data: { activeDeploymentId: deployment.id, status: "deployed" },
        });
    await tx.auditEvent.create({
      data: {
        projectId: session.projectId,
        environmentId: target.environmentId,
        actorType: "user",
        actorId: session.userId,
        action: "project_deployment.rolled_back",
        targetType: "project_deployment",
        targetId: target.id,
        metadata: { version: target.version },
      },
    });
  });
  return { ok: true, activeProjectDeploymentId: target.id, version: target.version };
});

app.get("/api/deployments", async (request, reply) => {
  const session = sessionContext(request);
  const query = parse(deploymentListQuerySchema, request.query);
  if (query.cursor)
    await assertScopedCursor("deployment", session.projectId, query.cursor);
  const summarySince = new Date(Date.now() - 7 * DAY_MS);
  const [rows, summaryRows, activeSnapshots] = await Promise.all([
    prisma.projectDeployment.findMany({
      where: {
        projectId: session.projectId,
        ...(query.environmentId ? { environmentId: query.environmentId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...dateWhere(query.from, query.to),
      },
      include: {
        environment: true,
        sourceProjectDeployment: { select: { id: true, version: true } },
        _count: { select: { endpointDeployments: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
    prisma.projectDeployment.findMany({
      where: {
        projectId: session.projectId,
        OR: [
          { createdAt: { gte: summarySince } },
          { status: { in: ["queued", "building", "deploying"] } },
        ],
      },
      select: { status: true, createdAt: true, completedAt: true },
    }),
    prisma.environment.count({
      where: {
        projectId: session.projectId,
        activeProjectDeploymentId: { not: null },
      },
    }),
  ]);
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const items = page.map((deployment) => ({
    id: deployment.id,
    version: deployment.version,
    status: deployment.status,
    checksum: deployment.checksum,
    environment: {
      id: deployment.environment.id,
      name: deployment.environment.name,
      slug: deployment.environment.slug,
      baseUrl: deployment.environment.baseUrl,
    },
    endpointCount: deployment._count.endpointDeployments,
    sourceProjectDeployment: deployment.sourceProjectDeployment ?? undefined,
    createdAt: deployment.createdAt,
    completedAt: deployment.completedAt ?? undefined,
  }));
  if (query.format === "csv")
    return replyCsv(
      reply,
      csv(items, [
        "id",
        "environment",
        "version",
        "status",
        "checksum",
        "endpointCount",
        "createdAt",
        "completedAt",
      ]),
      `deployments-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  return {
    items,
    nextCursor: hasMore ? page.at(-1)?.id : undefined,
    summary: summarizeDeployments(summaryRows, activeSnapshots),
  };
});
app.get("/api/executions", async (request, reply) => {
  const session = sessionContext(request);
  const query = parse(executionListQuerySchema, request.query);
  const rows = await prisma.functionExecution.findMany({
    where: {
      projectId: session.projectId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.endpointId ? { endpointId: query.endpointId } : {}),
      ...(query.functionId ? { functionId: query.functionId } : {}),
      ...(query.toolBindingId ? { mcpToolBindingId: query.toolBindingId } : {}),
      ...(query.httpRouteBindingId
        ? { httpRouteBindingId: query.httpRouteBindingId }
        : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(query.source ? { invocationSource: query.source } : {}),
      ...(query.callerSubject
        ? { callerIdentity: { path: ["subject"], equals: query.callerSubject } }
        : {}),
      ...dateWhere(query.from, query.to),
    } as never,
    include: {
      function: { select: { name: true } },
      endpoint: { select: { name: true } },
      deployment: { select: { version: true } },
      functionVersion: { select: { version: true } },
      mcpToolBinding: true,
      httpRouteBinding: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const items = redactSensitive(page.map(executionView));
  if (query.format === "csv")
    return replyCsv(
      reply,
      csv(items as Array<Record<string, unknown>>, [
        "id",
        "createdAt",
        "requestId",
        "correlationId",
        "invocationSource",
        "endpointId",
        "functionName",
        "binding",
        "caller",
        "status",
        "durationMs",
        "functionVersion",
        "deploymentVersion",
        "input",
        "output",
        "error",
      ]),
      `executions-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  return { items, nextCursor: hasMore ? page.at(-1)?.id : undefined };
});
app.get("/api/executions/:id", async (request, reply) => {
  const session = sessionContext(request);
  const { id } = request.params as { id: string };
  const row = await prisma.functionExecution.findFirst({
    where: { id, projectId: session.projectId },
    include: {
      function: { select: { name: true } },
      deployment: { select: { version: true } },
      functionVersion: { select: { version: true } },
      mcpToolBinding: { select: { toolName: true } },
      httpRouteBinding: { select: { method: true, path: true } },
    },
  });
  return row
    ? redactSensitive(executionView(row))
    : reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Execution not found",
          requestId: requestId(request),
        },
      });
});
app.get("/api/audit-events", async (request, reply) => {
  const session = sessionContext(request);
  const query = parse(auditListQuerySchema, request.query);
  const rows = await prisma.auditEvent.findMany({
    where: {
      projectId: session.projectId,
      ...(query.endpointId ? { endpointId: query.endpointId } : {}),
      ...(query.functionId ? { functionId: query.functionId } : {}),
      ...(query.action
        ? { action: { contains: query.action, mode: "insensitive" } }
        : {}),
      ...(query.actorType ? { actorType: query.actorType } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...dateWhere(query.from, query.to),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const items = redactSensitive(page.map(auditView));
  if (query.format === "csv")
    return replyCsv(
      reply,
      csv(items as Array<Record<string, unknown>>, [
        "id",
        "createdAt",
        "action",
        "actorType",
        "actorId",
        "targetType",
        "targetId",
        "endpointId",
        "functionId",
        "metadata",
      ]),
      `audit-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  return { items, nextCursor: hasMore ? page.at(-1)?.id : undefined };
});

app.get("/api/runtime-endpoints/:endpointId/manifest", async (request, reply) => {
  const session = sessionContext(request);
  const { endpointId } = request.params as { endpointId: string };
  const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
  if (!endpoint)
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Runtime endpoint not found",
        requestId: requestId(request),
      },
    });
  const manifest = currentEndpointManifest(endpoint);
  const format = (
    (request.query as { format?: string }).format === "json" ? "json" : "yaml"
  ) as "yaml" | "json";
  return {
    format,
    content: serializeManifest(manifest, format),
    manifest,
    containsSecretValues: false,
  };
});
app.post(
  "/api/runtime-endpoints/:endpointId/manifest/preview",
  async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const { endpointId } = request.params as { endpointId: string };
    const body = parse(
      manifestImportSchema.omit({ apply: true }),
      request.body,
    );
    const endpoint = await projectRepository(session.projectId).endpoint(
      endpointId,
    );
    if (!endpoint)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Runtime endpoint not found",
          requestId: requestId(request),
        },
      });
    const manifest = parseManifest(body.content, body.format);
    const plan = await createManifestPlan(session.projectId, endpoint, manifest);
    return { ...plan, manifest, atomic: true, containsSecretValues: false };
  },
);
app.post("/api/runtime-endpoints/:endpointId/manifest", async (request, reply) => {
  const session = sessionContext(request);
  requireRole(session, ["owner", "admin", "developer"]);
  const { endpointId } = request.params as { endpointId: string };
  const body = parse(manifestImportSchema, request.body);
  const endpoint = await projectRepository(session.projectId).endpoint(endpointId);
  if (!endpoint)
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Runtime endpoint not found",
        requestId: requestId(request),
      },
    });
  const manifest = parseManifest(body.content, body.format);
  const plan = await createManifestPlan(session.projectId, endpoint, manifest);
  if (!body.apply)
    return {
      ...plan,
      manifest,
      applied: false,
      atomic: true,
      containsSecretValues: false,
    };
  if (!plan.valid)
    return reply.status(422).send({
      error: {
        code: "MANIFEST_PLAN_INVALID",
        message:
          "Manifest cannot be applied until all plan errors are resolved",
        requestId: requestId(request),
        details: plan.errors,
      },
      plan,
      applied: false,
    });
  const functionsByName = new Map(endpoint.functions.map((fn) => [fn.name, fn]));
  const policies = await prisma.authPolicy.findMany({
    where: { projectId: session.projectId },
  });
  const policiesByName = new Map(
    policies.map((policy) => [policy.name, policy]),
  );
  const defaultPolicyId = manifest.auth
    ? (policiesByName.get(manifest.auth.policy)?.id ?? null)
    : null;
  const endpointRuntimeConfig = {
    timeoutMs: manifest.endpoint.runtime.timeoutMs,
    maxConcurrentRequests: manifest.endpoint.runtime.maxConcurrentRequests,
    env: manifest.endpoint.runtime.env,
    endpointAccessPolicy: manifest.endpoint.runtime.endpointAccessPolicy,
  };
  await prisma.$transaction(async (tx) => {
    await tx.runtimeEndpoint.update({
      where: { id: endpointId },
      data: {
        name: manifest.endpoint.name,
        slug: manifest.endpoint.slug,
        description: manifest.endpoint.description,
        runtimeVersion: manifest.endpoint.runtimeVersion,
        runtimeConfig: endpointRuntimeConfig,
        defaultAuthPolicyId: defaultPolicyId,
      },
    });
    await tx.networkPolicy.upsert({
      where: { endpointId },
      create: {
        projectId: session.projectId,
        endpointId,
        ...manifest.endpoint.network,
      },
      update: manifest.endpoint.network,
    });
    for (const fn of manifest.functions)
      await tx.function.update({
        where: { id: functionsByName.get(fn.name)!.id },
        data: {
          enabled: fn.enabled,
          riskLevel: fn.riskLevel,
          requiredPermissions: fn.requiredPermissions,
        },
      });
    const desiredToolNames = (manifest.mcp?.tools ?? []).map(
      (tool) => tool.toolName,
    );
    if (desiredToolNames.length)
      await tx.mcpToolBinding.deleteMany({
        where: { endpointId, toolName: { notIn: desiredToolNames } },
      });
    else await tx.mcpToolBinding.deleteMany({ where: { endpointId } });
    for (const tool of manifest.mcp?.tools ?? []) {
      const fn = functionsByName.get(tool.function)!;
      await tx.mcpToolBinding.upsert({
        where: { endpointId_toolName: { endpointId, toolName: tool.toolName } },
        create: {
          endpointId,
          functionId: fn.id,
          toolName: tool.toolName,
          title: tool.title ?? tool.toolName,
          description: tool.description,
          enabled: tool.enabled,
        },
        update: {
          functionId: fn.id,
          title: tool.title ?? tool.toolName,
          description: tool.description,
          enabled: tool.enabled,
        },
      });
    }
    const desiredRouteKeys = new Set(
      (manifest.http?.routes ?? []).map(
        (route) => `${route.method} ${route.path}`,
      ),
    );
    const deletedRouteIds = endpoint.httpRouteBindings
      .filter(
        (binding) => !desiredRouteKeys.has(`${binding.method} ${binding.path}`),
      )
      .map((binding) => binding.id);
    if (deletedRouteIds.length)
      await tx.httpRouteBinding.deleteMany({
        where: { id: { in: deletedRouteIds }, endpointId },
      });
    for (const route of manifest.http?.routes ?? []) {
      const fn = functionsByName.get(route.function)!;
      await tx.httpRouteBinding.upsert({
        where: {
          endpointId_method_path: {
            endpointId,
            method: route.method,
            path: route.path,
          },
        },
        create: {
          endpointId,
          functionId: fn.id,
          method: route.method,
          path: route.path,
          inputMapping: route.inputMapping,
          responseMapping: route.responseMapping,
          enabled: route.enabled,
        } as never,
        update: {
          functionId: fn.id,
          inputMapping: route.inputMapping,
          responseMapping: route.responseMapping,
          enabled: route.enabled,
        } as never,
      });
    }
    await tx.auditEvent.create({
      data: {
        projectId: session.projectId,
        environmentId: endpoint.environmentId,
        endpointId,
        actorType: "user",
        actorId: session.userId,
        action: "manifest.applied",
        targetType: "runtime_endpoint",
        targetId: endpointId,
        metadata: {
          summary: plan.summary,
          format: body.format,
          containsSecretValues: false,
        },
      },
    });
  });
  return {
    valid: true,
    applied: true,
    atomic: true,
    manifest,
    plan,
    containsSecretValues: false,
  };
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
function promoteEndpointSnapshot(
  value: unknown,
  environment: { id: string; slug: string; name: string; variables: unknown },
  connections: ReadonlyMap<string, { id: string; secretId: string }>,
): Record<string, unknown> {
  const snapshot = JSON.parse(JSON.stringify(record(value))) as Record<
    string,
    unknown
  >;
  snapshot.environment = {
    id: environment.id,
    slug: environment.slug,
    name: environment.name,
  };
  snapshot.env = record(environment.variables);
  snapshot.reviewedQueries = arrayRecords(snapshot.reviewedQueries).map(
    (query) => {
      const connection = record(query.connection);
      const name = typeof connection.name === "string" ? connection.name : "";
      const productionConnection = connections.get(name);
      return productionConnection
        ? {
            ...query,
            connection: {
              ...connection,
              id: productionConnection.id,
              secretId: productionConnection.secretId,
            },
          }
        : query;
    },
  );
  return snapshot;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function loadTemplateInstallContext(
  projectId: string,
  endpointId: string,
  templateId: string,
) {
  const template = functionTemplates.find(
    (candidate) => candidate.id === templateId,
  );
  if (!template) return null;
  const endpoint = await prisma.runtimeEndpoint.findFirst({
    where: { id: endpointId, projectId },
    include: { networkPolicy: true },
  });
  if (!endpoint) return null;
  const [secrets, authPolicies] = await Promise.all([
    prisma.secret.findMany({
      where: { projectId, environmentId: endpoint.environmentId },
      select: { id: true, name: true },
    }),
    prisma.authPolicy.findMany({
      where: { projectId },
      select: { id: true, type: true },
    }),
  ]);
  const platform = platformCapabilities();
  const capabilities = ["webhook_signature_auth"];
  if (endpoint.networkPolicy) capabilities.push("network_policy");
  if (platform.runtimeCapabilities.reviewedDatabaseQueries)
    capabilities.push("reviewed_database_queries");
  return {
    template,
    endpoint,
    context: {
      allowedHosts: stringList(endpoint.networkPolicy?.allowedHosts),
      secrets,
      authPolicies: authPolicies.map((policy) => ({
        id: policy.id,
        type: String(policy.type),
      })),
      capabilities,
    },
  };
}

type EndpointViewRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  kind: "mcp" | "http";
  status: string;
  createdAt: Date;
  updatedAt: Date;
  project: { slug: string };
  environment: { id: string; name: string; slug: string; baseUrl: string };
  activeDeployment: {
    id: string;
    version: number;
    createdAt: Date;
    checksum: string;
  } | null;
  defaultAuthPolicy?: { type: string } | null;
  _count: {
    mcpToolBindings: number;
    httpRouteBindings: number;
  };
  mcpToolBindings?: Array<{ functionId: string }>;
  httpRouteBindings?: Array<{ functionId: string }>;
};
function endpointView<T extends EndpointViewRow>(endpoint: T) {
  return {
    ...endpoint,
    endpoints: canonicalEndpointUrls(
      endpoint.environment.baseUrl,
      endpoint.project.slug,
      endpoint.slug,
    ),
    activeDeployment: endpoint.activeDeployment ?? undefined,
    functionCount: new Set([
      ...(endpoint.mcpToolBindings ?? []).map((binding) => binding.functionId),
      ...(endpoint.httpRouteBindings ?? []).map((binding) => binding.functionId),
    ]).size,
    mcpToolCount: endpoint._count.mcpToolBindings,
    httpRouteCount: endpoint._count.httpRouteBindings,
    authMode: endpoint.defaultAuthPolicy?.type ?? "none",
  };
}
type ExecutionViewRow = {
  id: string;
  endpointId: string;
  functionId: string;
  createdAt: Date;
  requestId: string;
  correlationId: string | null;
  parentExecutionId: string | null;
  rootExecutionId: string | null;
  invocationSource: string;
  status: string;
  durationMs: number;
  callerIdentity: unknown;
  input: unknown;
  output: unknown;
  error: unknown;
  function?: { name: string };
  deployment?: { version: number };
  functionVersion?: { version: number };
  mcpToolBinding?: { toolName: string } | null;
  httpRouteBinding?: { method: string; path: string } | null;
};
function executionView(row: ExecutionViewRow) {
  const callerIdentity =
    row.callerIdentity && typeof row.callerIdentity === "object"
      ? (row.callerIdentity as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    endpointId: row.endpointId,
    functionId: row.functionId,
    createdAt: row.createdAt,
    requestId: row.requestId,
    correlationId: row.correlationId ?? undefined,
    parentExecutionId: row.parentExecutionId ?? undefined,
    rootExecutionId: row.rootExecutionId ?? row.id,
    invocationSource: row.invocationSource,
    functionName: row.function?.name ?? "Unknown function",
    binding:
      row.mcpToolBinding?.toolName ??
      (row.httpRouteBinding
        ? `${row.httpRouteBinding.method} ${row.httpRouteBinding.path}`
        : undefined),
    caller:
      typeof callerIdentity.subject === "string"
        ? callerIdentity.subject
        : undefined,
    callerIdentity,
    status: row.status,
    durationMs: row.durationMs,
    functionVersion: row.functionVersion?.version ?? 0,
    deploymentVersion: row.deployment?.version ?? 0,
    input: row.input,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
  };
}
type AuditViewRow = {
  id: string;
  createdAt: Date;
  action: string;
  actorType: string;
  actorId: string | null;
  targetType: string;
  targetId: string | null;
};
function auditView(row: AuditViewRow) {
  return {
    ...row,
    actor: row.actorId ? `${row.actorType}:${row.actorId}` : row.actorType,
    targetId: row.targetId ?? undefined,
  };
}

type LoadedControlEndpoint = NonNullable<
  Awaited<ReturnType<ReturnType<typeof projectRepository>["endpoint"]>>
>;

function numericSetting(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function endpointSettingsView(endpoint: {
  name: string;
  slug: string;
  description: string;
  runtimeVersion: string;
  runtimeConfig: unknown;
}) {
  const config = record(endpoint.runtimeConfig);
  const rawEnvironment = record(config.env);
  const env = Object.fromEntries(
    Object.entries(rawEnvironment).filter(
      ([name, value]) =>
        typeof value === "string" &&
        !/(?:^|_)(?:SECRET|TOKEN|PASSWORD|API_KEY)(?:_|$)/.test(name),
    ),
  );
  return {
    name: endpoint.name,
    slug: endpoint.slug,
    description: endpoint.description,
    runtimeVersion: endpoint.runtimeVersion,
    runtime: {
      timeoutMs: numericSetting(config.timeoutMs, 30_000),
      maxConcurrentRequests: numericSetting(config.maxConcurrentRequests, 20),
    },
    env,
    omittedSensitiveEnvironmentVariableCount:
      Object.keys(rawEnvironment).length - Object.keys(env).length,
    endpointAccessPolicy: {
      mode:
        record(config.endpointAccessPolicy).mode === "restricted"
          ? "restricted"
          : "authenticated",
      allowedSubjects: stringList(
        record(config.endpointAccessPolicy).allowedSubjects,
      ),
    },
  };
}

function currentEndpointManifest(
  endpoint: LoadedControlEndpoint,
): EndpointManifest {
  const settings = endpointSettingsView(endpoint);
  const network = networkPolicyView(endpoint.networkPolicy);
  const functionName = new Map(endpoint.functions.map((fn) => [fn.id, fn.name]));
  return parseManifest(
    JSON.stringify({
      endpoint: {
        kind: endpoint.kind,
        name: endpoint.name,
        slug: endpoint.slug,
        description: endpoint.description,
        runtimeVersion: endpoint.runtimeVersion,
        runtime: {
          ...settings.runtime,
          env: settings.env,
          endpointAccessPolicy: settings.endpointAccessPolicy,
        },
        network: network.nextSnapshotPolicy,
      },
      ...(endpoint.defaultAuthPolicy
        ? { auth: { policy: endpoint.defaultAuthPolicy.name } }
        : {}),
      functions: endpoint.functions.map((fn) => ({
        name: fn.name,
        enabled: fn.enabled,
        riskLevel: fn.riskLevel,
        requiredPermissions: fn.requiredPermissions as string[],
      })),
      ...(endpoint.kind === "mcp" ? { mcp: {
        tools: endpoint.mcpToolBindings.map((binding) => ({
          toolName: binding.toolName,
          function: functionName.get(binding.functionId) ?? binding.functionId,
          title: binding.title,
          description: binding.description,
          enabled: binding.enabled,
        })),
      } } : {}),
      ...(endpoint.kind === "http" ? { http: {
        routes: endpoint.httpRouteBindings.map((binding) => ({
          method: binding.method,
          path: binding.path,
          function: functionName.get(binding.functionId) ?? binding.functionId,
          inputMapping: binding.inputMapping,
          responseMapping: binding.responseMapping,
          enabled: binding.enabled,
        })),
      } } : {}),
    }),
    "json",
  );
}

async function createManifestPlan(
  projectId: string,
  endpoint: LoadedControlEndpoint,
  manifest: EndpointManifest,
) {
  const policies = await prisma.authPolicy.findMany({
    where: { projectId },
    select: { id: true, name: true, type: true, config: true },
  });
  const plan = buildManifestPlan(
    {
      endpoint: {
        name: endpoint.name,
        slug: endpoint.slug,
        description: endpoint.description,
        kind: endpoint.kind,
      },
      functions: endpoint.functions,
      mcpBindings: endpoint.mcpToolBindings,
      httpBindings: endpoint.httpRouteBindings,
      authPolicies: policies,
    },
    manifest,
  );
  const networkValidation = networkPolicyUpdateSchema.safeParse(
    manifest.endpoint.network,
  );
  if (!networkValidation.success)
    plan.errors.push({
      code: "INVALID_NETWORK_POLICY",
      target: "endpoint.network",
      message: networkValidation.error.issues
        .map((issue) => issue.message)
        .join("; "),
    });
  const slugCollision = await prisma.runtimeEndpoint.findFirst({
    where: {
      projectId,
      environmentId: endpoint.environmentId,
      slug: manifest.endpoint.slug,
      id: { not: endpoint.id },
    },
    select: { id: true },
  });
  if (slugCollision)
    plan.errors.push({
      code: "SERVICE_SLUG_CONFLICT",
      target: manifest.endpoint.slug,
      message: "Another endpoint in this environment already uses this slug.",
    });
  const referencedPolicyNames = new Set([
    ...(manifest.auth ? [manifest.auth.policy] : []),
    ...(manifest.http?.routes ?? []).flatMap((route) =>
      [],
    ),
  ]);
  const environmentSecrets = new Set(
    (
      await prisma.secret.findMany({
        where: { projectId, environmentId: endpoint.environmentId },
        select: { name: true },
      })
    ).map((secret) => secret.name),
  );
  for (const policy of policies.filter((candidate) =>
    referencedPolicyNames.has(candidate.name),
  )) {
    const secretRef = record(policy.config).secretRef;
    if (typeof secretRef === "string" && !environmentSecrets.has(secretRef))
      plan.errors.push({
        code: "AUTH_POLICY_SECRET_NOT_FOUND",
        target: policy.name,
        message: `Policy secretRef '${secretRef}' is not configured in the endpoint environment.`,
      });
  }
  for (const policy of policies.filter(
    (candidate) =>
      referencedPolicyNames.has(candidate.name) &&
      providerStatus(candidate.type) !== "enabled",
  ))
    plan.errors.push({
      code: "AUTH_PROVIDER_DEFERRED",
      target: policy.name,
      message: `Authentication provider '${policy.type}' is not enabled in this deployment.`,
    });
  plan.valid = plan.errors.length === 0;
  return plan;
}

function dateWhere(from?: Date, to?: Date) {
  return from || to
    ? {
        createdAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      }
    : {};
}

function deploymentView(row: {
  id: string;
  endpointId: string;
  version: number;
  status: string;
  checksum: string;
  createdAt: Date;
  completedAt: Date | null;
  snapshot: unknown;
  endpoint: { name: string; environment: { name: string } };
  logs: unknown[];
}) {
  const snapshot = record(row.snapshot);
  return {
    id: row.id,
    endpointId: row.endpointId,
    endpointName: row.endpoint.name,
    environment: row.endpoint.environment.name,
    version: row.version,
    status: row.status,
    checksum: row.checksum,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    functionVersions: Array.isArray(snapshot.functions)
      ? snapshot.functions.length
      : 0,
    snapshotMetadata: {
      schemaVersion: snapshot.schemaVersion ?? null,
      seedRelease:
        typeof snapshot.seedRelease === "string" ? snapshot.seedRelease : null,
      functionCount: Array.isArray(snapshot.functions)
        ? snapshot.functions.length
        : 0,
      mcpBindingCount: Array.isArray(snapshot.mcpBindings)
        ? snapshot.mcpBindings.length
        : 0,
      httpBindingCount: Array.isArray(snapshot.httpBindings)
        ? snapshot.httpBindings.length
        : 0,
    },
    logs: row.logs,
  };
}

function replyCsv(reply: FastifyReply, content: string, filename: string) {
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header(
      "content-disposition",
      `attachment; filename=${JSON.stringify(filename)}`,
    )
    .send(content);
}

async function assertScopedCursor(
  kind: "execution" | "deployment" | "audit",
  projectId: string,
  id: string,
): Promise<void> {
  const found =
    kind === "execution"
      ? await prisma.functionExecution.findFirst({
          where: { id, projectId },
          select: { id: true },
        })
      : kind === "deployment"
        ? await prisma.projectDeployment.findFirst({
            where: { id, projectId },
            select: { id: true },
          })
        : await prisma.auditEvent.findFirst({
            where: { id, projectId },
            select: { id: true },
          });
  if (!found)
    throw Object.assign(
      new Error("Pagination cursor is invalid for this project"),
      { statusCode: 400, code: "INVALID_CURSOR" },
    );
}

function functionView<
  T extends {
    grants: Array<{
      secretName: string;
      secret?: { id: string; name: string } | null;
    }>;
  },
>(fn: T) {
  const { grants, ...functionData } = fn;
  return {
    ...functionData,
    secretGrants: grants.map((grant) => ({
      ...(grant.secret ? { secretId: grant.secret.id } : {}),
      name: grant.secretName,
    })),
  };
}

function policyView<T extends { type: string }>(policy: T) {
  return {
    ...policy,
    providerStatus: providerStatus(policy.type),
    mutable: providerStatus(policy.type) === "enabled",
  };
}

function networkPolicyView(
  policy: {
    id: string;
    allowedHosts: unknown;
    allowedMethods: unknown;
    allowedPorts: unknown;
    allowPrivateHosts: unknown;
    maxResponseBytes: number;
    updatedAt?: Date;
  } | null,
) {
  const allowedHosts = stringList(policy?.allowedHosts);
  const allowedMethods = stringList(policy?.allowedMethods);
  const allowedPorts = Array.isArray(policy?.allowedPorts)
    ? policy.allowedPorts.filter(
        (port): port is number => typeof port === "number",
      )
    : [];
  const allowPrivateHosts = stringList(policy?.allowPrivateHosts);
  const exactPolicy = {
    allowedHosts,
    allowedMethods,
    allowedPorts,
    maxResponseBytes: policy?.maxResponseBytes ?? 1_048_576,
    allowPrivateHosts,
  };
  return {
    id: policy?.id,
    ...exactPolicy,
    warnings: networkPolicyWarnings(allowedHosts, allowPrivateHosts),
    nextSnapshotPolicy: exactPolicy,
    updatedAt: policy?.updatedAt,
    configured: Boolean(policy),
  };
}

async function validatePolicySecretIfRequired(
  projectId: string,
  environmentId: string,
  config: object,
): Promise<void> {
  if (!("secretRef" in config) || typeof config.secretRef !== "string") return;
  const secretRef = config.secretRef;
  const secret = await prisma.secret.findFirst({
    where: { projectId, environmentId, name: secretRef },
    select: { id: true },
  });
  if (!secret)
    throw Object.assign(
      new Error(
        "Authentication policy secretRef must name a secret in the endpoint environment",
      ),
      { statusCode: 400, code: "INVALID_POLICY_SECRET_REF" },
    );
}

async function validateBindingReferences(
  projectId: string,
  endpointId: string,
  functionId: string,
  expectedKind: "mcp" | "http",
): Promise<void> {
  const [fn, endpoint] = await Promise.all([
    prisma.function.findFirst({
      where: { id: functionId, projectId },
      select: { id: true },
    }),
    prisma.runtimeEndpoint.findFirst({
      where: { id: endpointId, projectId, kind: expectedKind },
      select: { id: true },
    }),
  ]);
  if (!fn)
    throw Object.assign(
      new Error("The selected function does not belong to this project"),
      { statusCode: 400, code: "INVALID_BINDING_FUNCTION" },
    );
  if (!endpoint)
    throw Object.assign(new Error(`A ${expectedKind.toUpperCase()} endpoint is required`), {
      statusCode: 400,
      code: "ENDPOINT_KIND_MISMATCH",
    });
}

async function writeControlAudit(
  session: PlatformSession,
  endpointId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      projectId: session.projectId,
      endpointId,
      actorType: "user",
      actorId: session.userId,
      action,
      targetType,
      targetId,
      metadata: metadata as never,
    },
  });
}

async function setEndpointEnabled(
  session: PlatformSession,
  endpointId: string,
  enabled: boolean,
) {
  const endpoint = await prisma.runtimeEndpoint.findFirst({
    where: { id: endpointId, projectId: session.projectId },
  });
  if (!endpoint)
    throw Object.assign(new Error("Runtime endpoint not found"), {
      statusCode: 404,
      code: "NOT_FOUND",
    });
  const status = enabled
    ? endpoint.activeDeploymentId
      ? "deployed"
      : "draft"
    : "disabled";
  await prisma.runtimeEndpoint.update({
    where: { id: endpointId },
    data: { status },
  });
  await prisma.auditEvent.create({
    data: {
      projectId: session.projectId,
      environmentId: endpoint.environmentId,
      endpointId,
      actorType: "user",
      actorId: session.userId,
      action: enabled ? "endpoint.enabled" : "endpoint.disabled",
      targetType: "runtime_endpoint",
      targetId: endpointId,
      metadata: { status },
    },
  });
  return { ok: true, status };
}

async function purgeFunctionCache(
  projectId: string,
  environmentId: string,
): Promise<number> {
  const pattern = `mcpops:${projectId}:${environmentId}:*`;
  if (cacheInspector.status === "wait") await cacheInspector.connect();
  let cursor = "0";
  let scans = 0;
  const matchedKeys: string[] = [];
  do {
    const [nextCursor, keys] = await cacheInspector.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      500,
    );
    cursor = nextCursor;
    scans += 1;
    matchedKeys.push(...keys);
    if (scans > 10_000 || matchedKeys.length > 100_000)
      throw Object.assign(
        new Error(
          "Cache purge exceeded the safe inspection limit before making changes",
        ),
        { statusCode: 503, code: "CACHE_PURGE_LIMIT" },
      );
  } while (cursor !== "0");
  let purged = 0;
  for (let index = 0; index < matchedKeys.length; index += 500)
    purged += await cacheInspector.unlink(
      ...matchedKeys.slice(index, index + 500),
    );
  return purged;
}

async function inspectStorageMetadata(projectId: string, environmentId: string) {
  const now = new Date();
  const scope = { namespace: { projectId, environmentId } };
  const [namespaces, storedKeys, activeKeys, expiredKeys] = await Promise.all([
    prisma.storageNamespace.count({ where: { projectId, environmentId } }),
    prisma.storageEntry.count({ where: scope }),
    prisma.storageEntry.count({
      where: {
        ...scope,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    prisma.storageEntry.count({ where: { ...scope, expiresAt: { lte: now } } }),
  ]);
  return {
    namespaces,
    storedKeys,
    activeKeys,
    expiredKeys,
    valuesExposed: false,
  };
}

async function inspectCacheMetadata(
  projectId: string,
  environmentId: string,
) {
  const pattern = `mcpops:${projectId}:${environmentId}:*`;
  try {
    if (cacheInspector.status === "wait") await cacheInspector.connect();
    let cursor = "0";
    let activeKeys = 0;
    let scans = 0;
    do {
      const [nextCursor, keys] = await cacheInspector.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        500,
      );
      cursor = nextCursor;
      activeKeys += keys.length;
      scans += 1;
      if (scans > 10_000)
        return {
          status: "partial" as const,
          activeKeys,
          approximate: true,
          hitRate: null,
          hitRateAvailable: false,
          keyMaterialExposed: false,
        };
    } while (cursor !== "0");
    return {
      status: "available" as const,
      activeKeys,
      approximate: true,
      hitRate: null,
      hitRateAvailable: false,
      keyMaterialExposed: false,
    };
  } catch {
    return {
      status: "unavailable" as const,
      activeKeys: null,
      approximate: false,
      hitRate: null,
      hitRateAvailable: false,
      keyMaterialExposed: false,
    };
  }
}

async function probeRedisDependency(): Promise<"healthy" | "unavailable"> {
  try {
    if (cacheInspector.status === "wait") await cacheInspector.connect();
    return (await cacheInspector.ping()) === "PONG" ? "healthy" : "unavailable";
  } catch {
    return "unavailable";
  }
}

async function probeRuntimeEndpoint(endpointId: string) {
  const checkedAt = new Date();
  const base = (
    process.env.RUNTIME_INTERNAL_URL ?? "http://localhost:8080"
  ).replace(/\/+$/, "");
  try {
    const response = await fetch(
      `${base}/internal/runtime-endpoints/${encodeURIComponent(endpointId)}/manifest`,
      {
        headers: process.env.INTERNAL_API_TOKEN
          ? { "x-internal-token": process.env.INTERNAL_API_TOKEN }
          : {},
        signal: AbortSignal.timeout(2_000),
      },
    );
    return {
      status: response.ok ? ("healthy" as const) : ("degraded" as const),
      reachable: true,
      activeDeploymentLoadable: response.ok,
      statusCode: response.status,
      checkedAt,
    };
  } catch {
    return {
      status: "unavailable" as const,
      reachable: false,
      activeDeploymentLoadable: false,
      checkedAt,
    };
  }
}
