import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { prisma } from "@mcpops/db";
import { clearSession, enforceCsrf } from "./auth.js";
import { requestId, sendError, sessionContext } from "./helpers.js";
import { endpointIdentifierWhere, functionIdentifierWhere } from "./repository.js";

type CursorScope = "runtime_log" | "execution" | "deployment" | "audit";
type ApplicationOptions = {
  database?: typeof prisma;
  assertScopedCursor: (
    scope: CursorScope,
    projectId: string,
    cursor: string,
  ) => Promise<void>;
};

export async function createApiApplication(
  options: ApplicationOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-csrf-token",
      ],
    },
    genReqId: (request) =>
      String(request.headers["x-request-id"] ?? crypto.randomUUID()),
  });
  await registerPlatformPlugins(app);
  app.setErrorHandler((error, request, reply) => {
    if (request.url.startsWith("/oauth/")) {
      const value = error as { code?: string; statusCode?: number; message?: string };
      return reply.status(value.statusCode ?? 400).send({
        error: value.code ?? "invalid_request",
        error_description: value.message ?? "OAuth request failed",
      });
    }
    return sendError(reply, request, error);
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", requestId(request));
  });
  app.addHook("preHandler", async (request, reply) =>
    authenticatePlatformRequest({
      request,
      reply,
      database: options.database ?? prisma,
      assertScopedCursor: options.assertScopedCursor,
    }),
  );
  return app;
}

async function registerPlatformPlugins(app: FastifyInstance): Promise<void> {
  await app.register(cookie);
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(String(body))));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip,
  });
}

type AuthenticationOptions = ApplicationOptions & {
  request: FastifyRequest;
  reply: FastifyReply;
  database: typeof prisma;
};

async function authenticatePlatformRequest({
  request,
  reply,
  database,
  assertScopedCursor,
}: AuthenticationOptions): Promise<unknown> {
  if (isPublicRequest(request.url)) return;
  if (!request.url.startsWith("/api/")) return;

  const session = sessionContext(request);
  const sessionUser = await database.user.findFirst({
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
  )
    return rejectInvalidSession(reply, request);
  if (sessionUser.mustChangePassword && !isPasswordChangeRequest(request.url))
    return reply.status(403).send({
      error: {
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "Change the temporary password before continuing",
        requestId: requestId(request),
      },
    });

  enforceCsrf(request);
  const resolved = await resolveResourceIdentifiers({ request, reply, database });
  if (resolved) return resolved;
  await validateCursorScope({
    request,
    projectId: session.projectId,
    assertScopedCursor,
  });
}

function isPublicRequest(url: string): boolean {
  return ["/api/auth/login", "/api/setup", "/health"].some((path) =>
    url.startsWith(path),
  );
}

function isPasswordChangeRequest(url: string): boolean {
  return ["/api/auth/me", "/api/auth/logout", "/api/account/password"].some((path) =>
    url.startsWith(path),
  );
}

function rejectInvalidSession(reply: FastifyReply, request: FastifyRequest): unknown {
  clearSession(reply);
  return reply.status(401).send({
    error: {
      code: "UNAUTHENTICATED",
      message: "Session is no longer valid",
      requestId: requestId(request),
    },
  });
}

async function resolveResourceIdentifiers({
  request,
  reply,
  database,
}: Pick<AuthenticationOptions, "request" | "reply" | "database">): Promise<unknown> {
  const session = sessionContext(request);
  const params = request.params as { endpointId?: string; functionId?: string };
  if (!params.endpointId) return;
  const endpoint = await database.runtimeEndpoint.findFirst({
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
  if (!params.functionId || params.functionId === "new") return;
  const fn = await database.function.findFirst({
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

async function validateCursorScope({
  request,
  projectId,
  assertScopedCursor,
}: {
  request: FastifyRequest;
  projectId: string;
  assertScopedCursor: ApplicationOptions["assertScopedCursor"];
}): Promise<void> {
  const cursor = (request.query as { cursor?: unknown }).cursor;
  if (
    typeof cursor !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      cursor,
    )
  )
    return;
  const scopes: Array<[string, CursorScope]> = [
    ["/api/logs", "runtime_log"],
    ["/api/executions", "execution"],
    ["/api/deployments", "deployment"],
    ["/api/audit-events", "audit"],
  ];
  const match = scopes.find(([prefix]) => request.url.startsWith(prefix));
  if (match) await assertScopedCursor(match[1], projectId, cursor);
}
