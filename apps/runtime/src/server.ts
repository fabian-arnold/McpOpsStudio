import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequestSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createFunctionExecutorFromEnvironment,
  LocalChildProcessExecutor,
  parseMasterKey,
  type FunctionExecutor,
} from "@mcpops/sandbox";
import {
  asSafeRuntimeError,
  SafeRuntimeError,
  type CallerIdentity,
} from "@mcpops/runtime-sdk";
import { verifyApiKey } from "@mcpops/shared";
import { authenticateWithPolicies, authorizeEndpointAccess } from "./auth.js";
import { RuntimeInvoker } from "./invoke.js";
import { customAuthenticationInvoker } from "./custom-auth-invoker.js";
import { RuntimeMetrics } from "./metrics.js";
import { registerInternalRoutes } from "./internal-routes.js";
import {
  applyHttpResponseMapping,
  auditAuthDenial,
  auditEndpointAccessDenial,
  correlation,
  findFunction,
  isPublicRuntimePath,
  jsonRpcError,
  mapHttpInput,
  matchHttpBinding,
  object,
  parseRpc,
  requestAbortSignal,
  requestValue,
  resolveEndpoint,
  rpcResponse,
  runtimeRequestHost,
  sendError,
  stringHeader,
  type AppliedHttpResponse,
} from "./server-utils.js";
import { countAndValidateActiveDeployments, probeDatabase } from "./repository.js";
import { checkRuntimeReadiness } from "./readiness.js";

export {
  applyHttpResponseMapping,
  isPublicRuntimePath,
  mapHttpInput,
  normalizeTestSource,
} from "./server-utils.js";

type RuntimeOptions = {
  masterKey: Buffer;
  redisUrl: string;
  internalApiToken?: string;
  requireInternalProxyAuth?: boolean;
  runtimeConcurrency?: number;
  executor?: FunctionExecutor;
};

export function createRuntimeRequestCapacity(limit: number) {
  const activeRequests = new WeakSet<object>();
  const capacity = Math.max(1, limit);
  let activeCount = 0;

  return {
    acquire(request: object) {
      if (activeCount >= capacity) return false;
      activeRequests.add(request);
      activeCount += 1;
      return true;
    },
    release(request: object) {
      if (!activeRequests.delete(request)) return;
      activeCount = Math.max(0, activeCount - 1);
    },
    activeCount() {
      return activeCount;
    },
  };
}

export async function buildRuntimeApp(
  options: RuntimeOptions,
): Promise<FastifyInstance> {
  if (!options.executor && process.env.NODE_ENV === "production")
    throw new Error("A FunctionExecutor must be explicitly selected in production");
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-api-key",
        "req.headers.x-internal-token",
      ],
    },
    genReqId: (request) => String(request.headers["x-request-id"] ?? randomUUID()),
    bodyLimit: 1_048_576,
  });
  const rawBodies = new WeakMap<object, Buffer>();
  const runtimeConcurrency = Math.max(1, options.runtimeConcurrency ?? 40);
  const runtimeCapacity = createRuntimeRequestCapacity(runtimeConcurrency);
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    /^application\/(?:json|[a-z0-9.+-]+\+json)$/i,
    { parseAs: "buffer" },
    (request, body, done) => {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      rawBodies.set(request.raw, bytes);
      try {
        done(null, bytes.length ? JSON.parse(bytes.toString("utf8")) : {});
      } catch {
        done(
          new SafeRuntimeError({
            code: "VALIDATION_ERROR",
            message: "The request body is not valid JSON.",
            requestId: request.id,
          }),
          undefined,
        );
      }
    },
  );
  const metrics = new RuntimeMetrics();
  const executor = options.executor ?? new LocalChildProcessExecutor();
  const invoker = new RuntimeInvoker(
    options.redisUrl,
    options.masterKey,
    metrics,
    executor,
  );
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (request) =>
      `${request.ip}:${String(request.headers["x-api-key"] ?? "anonymous").slice(0, 12)}`,
  });
  app.addHook("onRequest", async (request, reply) => {
    metrics.recordRequest();
    const path = request.url.split("?", 1)[0] ?? request.url;
    const isRuntimeInvocation = isPublicRuntimePath(path);
    if (!isRuntimeInvocation) return;
    if (
      options.requireInternalProxyAuth &&
      (!options.internalApiToken ||
        !verifyApiKey(
          stringHeader(request, "x-internal-token"),
          options.internalApiToken,
        ))
    ) {
      return sendError(reply, {
        code: "UNAUTHENTICATED",
        message: "Internal proxy authentication is required.",
        requestId: request.id,
      });
    }
    // The hop credential authenticates Caddy, not the caller. Never expose it
    // to input mappings, user functions, persisted payloads, or request logs.
    delete request.headers["x-internal-token"];
    if (!runtimeCapacity.acquire(request)) {
      return sendError(reply, {
        code: "RATE_LIMITED",
        message: "The runtime worker is at capacity. Retry the request shortly.",
        requestId: request.id,
        retryable: true,
      });
    }
  });
  app.addHook("onResponse", async (request) => {
    runtimeCapacity.release(request);
  });
  app.addHook("onError", async (request) => {
    runtimeCapacity.release(request);
  });
  app.addHook("onRequestAbort", async (request) => {
    runtimeCapacity.release(request);
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    const incomingCorrelation = stringHeader(request, "x-correlation-id");
    if (incomingCorrelation) reply.header("x-correlation-id", incomingCorrelation);
    return payload;
  });
  app.addHook("onClose", async () => invoker.close());

  const readiness = async () => {
    const result = await checkRuntimeReadiness({
      postgres: probeDatabase,
      redis: () => invoker.probeCache(),
      activeDeployments: countAndValidateActiveDeployments,
    });
    metrics.recordReadiness(result.checks, result.activeDeploymentCount);
    return result;
  };
  registerInternalRoutes(app, {
    executor,
    ...(options.internalApiToken ? { internalApiToken: options.internalApiToken } : {}),
    invoker,
    metrics,
    readiness,
  });

  const handleMcp = async (
    request: FastifyRequest<{
      Params: { projectSlug: string; endpointSlug: string };
      Body: unknown;
    }>,
    reply: FastifyReply,
    environmentSlug: "development" | "production",
  ) => {
    const endpoint = await resolveEndpoint(
      request.params.projectSlug,
      request.params.endpointSlug,
      "mcp",
      runtimeRequestHost(request),
      environmentSlug,
      request.id,
      reply,
    );
    if (!endpoint) return;
    let caller: CallerIdentity;
    try {
      caller = await authenticateWithPolicies(
        request,
        endpoint,
        endpoint.snapshot.authPolicies,
        options.masterKey,
        {
          endpoint: "mcp",
          invokeCustomFunction: customAuthenticationInvoker(request, endpoint, invoker),
        },
      );
    } catch (error) {
      await auditAuthDenial(endpoint, request.id);
      return sendError(reply, asSafeRuntimeError(error, request.id));
    }
    try {
      authorizeEndpointAccess(
        caller,
        endpoint.snapshot.endpointAccessPolicy,
        request.id,
      );
    } catch (error) {
      await auditEndpointAccessDenial(endpoint, caller, request.id);
      return sendError(reply, asSafeRuntimeError(error, request.id));
    }
    const rpc = parseRpc(request.body);
    if (!rpc)
      return reply
        .code(400)
        .send(jsonRpcError(null, -32600, "Invalid Request", request.id));
    const schema =
      rpc.method === "initialize"
        ? InitializeRequestSchema
        : rpc.method === "tools/list"
          ? ListToolsRequestSchema
          : rpc.method === "tools/call"
            ? CallToolRequestSchema
            : undefined;
    if (schema && !schema.safeParse(rpc).success)
      return reply
        .code(400)
        .send(
          jsonRpcError(rpc.id ?? null, -32602, "Invalid method parameters", request.id),
        );
    if (rpc.method === "initialize") {
      const requestedVersion = object(rpc.params).protocolVersion;
      const protocolVersion =
        typeof requestedVersion === "string" &&
        SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
          ? requestedVersion
          : LATEST_PROTOCOL_VERSION;
      return rpcResponse(rpc, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: `MCP Ops Studio: ${endpoint.name}`,
          version: "0.1.0",
        },
      });
    }
    if (rpc.method === "notifications/initialized") return reply.code(202).send();
    if (rpc.method === "tools/list") {
      const tools = endpoint.snapshot.mcpBindings
        .filter((binding) => binding.enabled)
        .flatMap((binding) => {
          const fn = findFunction(endpoint, binding.functionId);
          return fn?.enabled
            ? [
                {
                  name: binding.toolName,
                  title: binding.title,
                  description: binding.description,
                  inputSchema: fn.inputSchema,
                },
              ]
            : [];
        });
      return rpcResponse(rpc, { tools });
    }
    if (rpc.method === "tools/call") {
      const params = object(requestValue(rpc.params));
      const binding = endpoint.snapshot.mcpBindings.find(
        (candidate) => candidate.enabled && candidate.toolName === params.name,
      );
      const fn = binding && findFunction(endpoint, binding.functionId);
      if (!binding || !fn?.enabled)
        return reply.send(
          jsonRpcError(rpc.id ?? null, -32602, "Unknown or disabled tool", request.id),
        );
      const correlationId = correlation(request);
      const tenantId = caller.tenantId ?? stringHeader(request, "x-tenant-id");
      const result = await invoker.invoke({
        endpoint,
        fn,
        source: "mcp",
        input: params.arguments ?? {},
        caller,
        requestId: request.id,
        abortSignal: requestAbortSignal(request),
        ...(correlationId ? { correlationId } : {}),
        ...(tenantId ? { tenantId } : {}),
        mcpBinding: binding,
      });
      if (!result.ok)
        return rpcResponse(rpc, {
          isError: true,
          content: [{ type: "text", text: result.error.message }],
          structuredContent: { error: result.error.toJSON() },
        });
      return rpcResponse(rpc, {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result.output) }],
        structuredContent: result.output,
      });
    }
    return reply.send(
      jsonRpcError(rpc.id ?? null, -32601, "Method not found", request.id),
    );
  };
  app.post<{ Params: { projectSlug: string; endpointSlug: string }; Body: unknown }>(
    "/mcp/:projectSlug/:endpointSlug",
    (request, reply) => handleMcp(request, reply, "production"),
  );
  app.post<{ Params: { projectSlug: string; endpointSlug: string }; Body: unknown }>(
    "/mcp-dev/:projectSlug/:endpointSlug",
    (request, reply) => handleMcp(request, reply, "development"),
  );

  const handleHttp = async (
    request: FastifyRequest<{
      Params: { projectSlug: string; endpointSlug: string; "*": string };
      Body: unknown;
    }>,
    reply: FastifyReply,
    environmentSlug: "development" | "production",
  ) => {
    const endpoint = await resolveEndpoint(
      request.params.projectSlug,
      request.params.endpointSlug,
      "http",
      runtimeRequestHost(request),
      environmentSlug,
      request.id,
      reply,
    );
    if (!endpoint) return;
    const routePath = `/${request.params["*"]}`;
    const matched = matchHttpBinding(endpoint, request.method, routePath);
    if (!matched)
      return reply.code(404).send({
        error: {
          code: "CONFIGURATION_ERROR",
          message: "No active route matches this request.",
          requestId: request.id,
        },
      });
    let caller: CallerIdentity;
    try {
      caller = await authenticateWithPolicies(
        request,
        endpoint,
        endpoint.snapshot.authPolicies,
        options.masterKey,
        {
          endpoint: "http",
          ...(rawBodies.get(request.raw)
            ? { rawBody: rawBodies.get(request.raw) as Buffer }
            : {}),
          replayStore: {
            claim: (key, ttlSeconds) => invoker.claimReplay(key, ttlSeconds),
          },
          invokeCustomFunction: customAuthenticationInvoker(request, endpoint, invoker),
        },
      );
    } catch (error) {
      await auditAuthDenial(endpoint, request.id);
      return sendError(reply, asSafeRuntimeError(error, request.id));
    }
    try {
      authorizeEndpointAccess(
        caller,
        endpoint.snapshot.endpointAccessPolicy,
        request.id,
      );
    } catch (error) {
      await auditEndpointAccessDenial(endpoint, caller, request.id);
      return sendError(reply, asSafeRuntimeError(error, request.id));
    }
    const input = mapHttpInput(matched.binding, matched.params, request);
    const correlationId = correlation(request);
    const tenantId = caller.tenantId ?? stringHeader(request, "x-tenant-id");
    const result = await invoker.invoke({
      endpoint,
      fn: matched.fn,
      source: "http",
      input,
      caller,
      requestId: request.id,
      abortSignal: requestAbortSignal(request),
      outputTransformer: (output) =>
        applyHttpResponseMapping(output, matched.binding.responseMapping, request.id),
      ...(correlationId ? { correlationId } : {}),
      ...(tenantId ? { tenantId } : {}),
      httpBinding: matched.binding,
    });
    if (!result.ok) return sendError(reply, result.error);
    reply.header("x-request-id", request.id);
    if (correlationId) reply.header("x-correlation-id", correlationId);
    const mapped = result.output as AppliedHttpResponse;
    for (const [name, value] of Object.entries(mapped.headers))
      reply.header(name, value);
    return reply.code(mapped.statusCode).send(mapped.body);
  };
  app.all<{
    Params: { projectSlug: string; endpointSlug: string; "*": string };
    Body: unknown;
  }>("/http/:projectSlug/:endpointSlug/*", (request, reply) =>
    handleHttp(request, reply, "production"),
  );
  app.all<{
    Params: { projectSlug: string; endpointSlug: string; "*": string };
    Body: unknown;
  }>("/http-dev/:projectSlug/:endpointSlug/*", (request, reply) =>
    handleHttp(request, reply, "development"),
  );

  app.setErrorHandler((error, request, reply) => {
    const caught = error instanceof Error ? error : new Error("Unknown runtime error");
    request.log.error(
      { err: { message: caught.message, name: caught.name } },
      "Runtime request failed",
    );
    return sendError(reply, asSafeRuntimeError(error, request.id));
  });
  return app;
}

async function main(): Promise<void> {
  const executor = await createFunctionExecutorFromEnvironment(process.env);
  const app = await buildRuntimeApp({
    masterKey: parseMasterKey(process.env.MCP_OPS_MASTER_KEY),
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    executor,
    ...(process.env.INTERNAL_API_TOKEN
      ? { internalApiToken: process.env.INTERNAL_API_TOKEN }
      : {}),
    requireInternalProxyAuth: process.env.REQUIRE_INTERNAL_PROXY_AUTH === "true",
    runtimeConcurrency: Number(process.env.RUNTIME_CONCURRENCY ?? 40),
  });
  await app.listen({
    port: Number(process.env.RUNTIME_PORT ?? 8080),
    host: process.env.HOST ?? "0.0.0.0",
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main();
