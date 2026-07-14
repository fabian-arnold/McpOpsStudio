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
import {
  deploymentSnapshotSchema,
  type HttpBinding,
  type LoadedEndpoint,
  type SnapshotFunction,
} from "./domain.js";
import { RuntimeInvoker } from "./invoke.js";
import { RuntimeMetrics } from "./metrics.js";
import {
  countAndValidateActiveDeployments,
  loadEndpoint,
  loadEndpointById,
  probeDatabase,
  saveAudit,
} from "./repository.js";
import { checkRuntimeReadiness } from "./readiness.js";

type RuntimeOptions = {
  masterKey: Buffer;
  redisUrl: string;
  internalApiToken?: string;
  requireInternalProxyAuth?: boolean;
  runtimeConcurrency?: number;
  executor?: FunctionExecutor;
};
type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
};

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
  const activeRuntimeRequests = new WeakSet<object>();
  const runtimeConcurrency = Math.max(1, options.runtimeConcurrency ?? 40);
  let activeRuntimeRequestCount = 0;
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
    if (activeRuntimeRequestCount >= runtimeConcurrency) {
      return sendError(reply, {
        code: "RATE_LIMITED",
        message: "The runtime worker is at capacity. Retry the request shortly.",
        requestId: request.id,
        retryable: true,
      });
    }
    activeRuntimeRequestCount += 1;
    activeRuntimeRequests.add(request);
  });
  app.addHook("onResponse", async (request) => {
    if (activeRuntimeRequests.delete(request)) activeRuntimeRequestCount -= 1;
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
  app.get("/health", async () => ({
    status: "alive",
    component: "runtime",
    executor: executor.metadata,
    timestamp: new Date().toISOString(),
  }));
  app.get("/internal/capabilities", async (request, reply) => {
    if (
      options.internalApiToken &&
      request.headers["x-internal-token"] !== options.internalApiToken
    )
      return sendError(reply, {
        code: "UNAUTHENTICATED",
        message: "Internal authentication is required.",
        requestId: request.id,
      });
    return {
      executor: executor.metadata,
    };
  });
  app.get("/ready", async (_request, reply) => {
    const result = await readiness();
    return reply.code(result.ready ? 200 : 503).send({
      status: result.ready ? "ready" : "not_ready",
      checks: Object.fromEntries(
        Object.entries(result.checks).map(([name, ready]) => [
          name,
          ready ? "ok" : "unavailable",
        ]),
      ),
      activeDeployments: result.activeDeploymentCount,
      timestamp: new Date().toISOString(),
    });
  });
  app.get("/metrics", async (_request, reply) => {
    await readiness();
    return reply.type(metrics.contentType).send(await metrics.render());
  });
  app.get<{ Params: { endpointId: string } }>(
    "/internal/runtime-endpoints/:endpointId/manifest",
    async (request, reply) => {
      if (
        options.internalApiToken &&
        request.headers["x-internal-token"] !== options.internalApiToken
      )
        return sendError(reply, {
          code: "UNAUTHENTICATED",
          message: "Internal authentication is required.",
          requestId: request.id,
        });
      const endpoint = await loadEndpointById(request.params.endpointId);
      if (!endpoint)
        return reply.code(404).send({
          error: {
            code: "CONFIGURATION_ERROR",
            message: "Active endpoint not found.",
            requestId: request.id,
          },
        });
      return {
        endpoint: {
          id: endpoint.id,
          name: endpoint.name,
          slug: endpoint.slug,
          project: endpoint.project,
          environment: endpoint.environment,
        },
        deployment: endpoint.deployment,
        functions: endpoint.snapshot.functions.map(
          ({ compiledCode: _code, ...fn }) => fn,
        ),
        mcpBindings: endpoint.snapshot.mcpBindings,
        httpBindings: endpoint.snapshot.httpBindings,
        networkPolicy: endpoint.snapshot.networkPolicy,
      };
    },
  );
  app.post<{
    Params: { endpointId: string; functionId: string };
    Body: unknown;
  }>(
    "/internal/runtime-endpoints/:endpointId/functions/:functionId/test",
    async (request, reply) => {
      if (
        options.internalApiToken &&
        request.headers["x-internal-token"] !== options.internalApiToken
      )
        return sendError(reply, {
          code: "UNAUTHENTICATED",
          message: "Internal authentication is required.",
          requestId: request.id,
        });
      const endpoint = await loadEndpointById(request.params.endpointId);
      if (!endpoint)
        return reply.code(404).send({
          error: {
            code: "CONFIGURATION_ERROR",
            message: "Active endpoint not found.",
            requestId: request.id,
          },
        });
      const body = object(request.body);
      const savedDevelopmentSnapshot = object(body.savedDevelopmentSnapshot);
      const parsedSnapshot = deploymentSnapshotSchema.safeParse({
        ...endpoint.snapshot,
        functions: savedDevelopmentSnapshot.functions,
        functionCalls: savedDevelopmentSnapshot.calls,
      });
      if (!parsedSnapshot.success)
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "The saved development Function snapshot is invalid.",
            requestId: request.id,
          },
        });
      const testEndpoint: LoadedEndpoint = {
        ...endpoint,
        snapshot: parsedSnapshot.data,
      };
      const fn = findFunction(testEndpoint, request.params.functionId);
      if (!fn?.enabled)
        return reply.code(404).send({
          error: {
            code: "CONFIGURATION_ERROR",
            message: "Function has no saved development version.",
            requestId: request.id,
          },
        });
      const rawCaller = object(body.caller);
      const caller: CallerIdentity = {
        ...(typeof rawCaller.subject === "string"
          ? { subject: rawCaller.subject }
          : {}),
        ...(typeof rawCaller.email === "string" ? { email: rawCaller.email } : {}),
        permissions: stringArray(rawCaller.permissions),
        claims: object(rawCaller.claims ?? rawCaller),
      };
      try {
        authorizeEndpointAccess(
          caller,
          testEndpoint.snapshot.endpointAccessPolicy,
          request.id,
        );
      } catch (error) {
        await auditEndpointAccessDenial(testEndpoint, caller, request.id);
        return sendError(reply, asSafeRuntimeError(error, request.id));
      }
      const correlationId = correlation(request);
      const simulatedSource = normalizeTestSource(body.source);
      const result = await invoker.invoke({
        endpoint: testEndpoint,
        fn,
        source: "test",
        ...(simulatedSource ? { simulatedSource } : {}),
        input: body.input ?? {},
        caller,
        requestId: request.id,
        abortSignal: requestAbortSignal(request),
        ...(correlationId ? { correlationId } : {}),
      });
      const metadata = {
        executionMode: "saved_development_version" as const,
        invocationSource: "test" as const,
        simulatedSource: simulatedSource ?? null,
        activeDeployment: {
          id: endpoint.deployment.id,
          version: endpoint.deployment.version,
          checksum: endpoint.deployment.checksum,
        },
        functionVersion: fn.version ?? null,
        functionVersionId: fn.versionId ?? null,
        executionId: result.executionId,
      };
      return result.ok
        ? {
            status: "success",
            output: result.output,
            durationMs: result.durationMs,
            requestId: request.id,
            logs: result.logs,
            ...metadata,
          }
        : {
            status: result.error.code === "TIMEOUT" ? "timeout" : "error",
            error: result.error.toJSON(),
            durationMs: result.durationMs,
            requestId: request.id,
            logs: result.logs,
            ...metadata,
          };
    },
  );

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
        { endpoint: "mcp" },
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

async function resolveEndpoint(
  org: string,
  slug: string,
  kind: "mcp" | "http",
  requestHost: string | undefined,
  environmentSlug: string | undefined,
  requestId: string,
  reply: FastifyReply,
): Promise<LoadedEndpoint | null> {
  const endpoint = await loadEndpoint(org, slug, kind, requestHost, environmentSlug);
  if (!endpoint) {
    await reply.code(404).send({
      error: {
        code: "CONFIGURATION_ERROR",
        message: "No active deployment was found.",
        requestId,
      },
    });
    return null;
  }
  return endpoint;
}
function runtimeRequestHost(request: FastifyRequest): string | undefined {
  const forwarded = request.headers["x-forwarded-host"];
  return typeof forwarded === "string"
    ? forwarded.split(",", 1)[0]?.trim()
    : request.headers.host;
}
function findFunction(
  endpoint: LoadedEndpoint,
  id: string,
): SnapshotFunction | undefined {
  return endpoint.snapshot.functions.find((fn) => fn.functionId === id || fn.id === id);
}
function parseRpc(value: unknown): JsonRpcRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return row.jsonrpc === "2.0" && typeof row.method === "string"
    ? (row as JsonRpcRequest)
    : null;
}
function rpcResponse(request: JsonRpcRequest, result: unknown) {
  return { jsonrpc: "2.0", id: request.id ?? null, result };
}
function jsonRpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  requestId: string,
) {
  return { jsonrpc: "2.0", id, error: { code, message, data: { requestId } } };
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
function requestValue(value: unknown): unknown {
  return value ?? {};
}
function correlation(request: FastifyRequest): string | undefined {
  return stringHeader(request, "x-correlation-id");
}
function stringHeader(request: FastifyRequest, header: string): string | undefined {
  const value = request.headers[header];
  return typeof value === "string" && value.length <= 256 ? value : undefined;
}

function matchHttpBinding(
  endpoint: LoadedEndpoint,
  method: string,
  path: string,
): {
  binding: HttpBinding;
  fn: SnapshotFunction;
  params: Record<string, string>;
} | null {
  for (const binding of endpoint.snapshot.httpBindings) {
    if (!binding.enabled || binding.method !== method) continue;
    const keys: string[] = [];
    const pattern = binding.path
      .split("/")
      .map((part) =>
        part.startsWith(":")
          ? (keys.push(part.slice(1)), "([^/]+)")
          : escapeRegex(part),
      )
      .join("/");
    const match = new RegExp(`^${pattern}/?$`).exec(path);
    if (!match) continue;
    const fn = findFunction(endpoint, binding.functionId);
    if (!fn?.enabled) continue;
    const params: Record<string, string> = {};
    keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1] ?? "");
    });
    return { binding, fn, params };
  }
  return null;
}
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function mapHttpInput(
  binding: HttpBinding,
  params: Record<string, string>,
  request: FastifyRequest,
): unknown {
  const query = object(request.query);
  const body = object(request.body);
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([, value]) => typeof value === "string"),
  );
  if (!binding.inputMapping || !Object.keys(binding.inputMapping).length)
    return { ...query, ...params, ...body };
  const sources: Record<string, Record<string, unknown>> = {
    path: params,
    query,
    headers,
    body,
  };
  const mapped: Record<string, unknown> = {};
  for (const [target, expression] of Object.entries(binding.inputMapping)) {
    if (typeof expression !== "string") continue;
    if (!expression.includes(".")) {
      mapped[target] =
        params[expression] ??
        query[expression] ??
        body[expression] ??
        headers[expression];
      continue;
    }
    const [source, ...parts] = expression.replace(/^\$\./, "").split(".");
    let current: unknown = source ? sources[source] : undefined;
    for (const part of parts) current = object(current)[part];
    mapped[target] = current;
  }
  return mapped;
}
function statusFor(code: SafeRuntimeError["code"]): number {
  return code === "UNAUTHENTICATED"
    ? 401
    : code === "FORBIDDEN"
      ? 403
      : code === "VALIDATION_ERROR"
        ? 400
        : code === "RATE_LIMITED"
          ? 429
          : code === "TIMEOUT"
            ? 504
            : code === "UPSTREAM_ERROR"
              ? 502
              : code === "CONFIGURATION_ERROR"
                ? 503
                : 500;
}
function sendError(
  reply: FastifyReply,
  error: ReturnType<SafeRuntimeError["toJSON"]> | SafeRuntimeError,
) {
  const shape = "toJSON" in error ? error.toJSON() : error;
  return reply.code(statusFor(shape.code)).send({ error: shape });
}
async function auditAuthDenial(
  endpoint: LoadedEndpoint,
  requestId: string,
): Promise<void> {
  await saveAudit({
    projectId: endpoint.project.id,
    environmentId: endpoint.environment.id,
    endpointId: endpoint.id,
    actorType: "caller",
    action: "runtime.authentication.denied",
    targetType: "runtime_endpoint",
    targetId: endpoint.id,
    metadata: { requestId },
  });
}
async function auditEndpointAccessDenial(
  endpoint: LoadedEndpoint,
  caller: CallerIdentity,
  requestId: string,
): Promise<void> {
  await saveAudit({
    projectId: endpoint.project.id,
    environmentId: endpoint.environment.id,
    endpointId: endpoint.id,
    actorType: "caller",
    ...(caller.subject ? { actorId: caller.subject } : {}),
    action: "endpoint.access.denied",
    targetType: "runtime_endpoint",
    targetId: endpoint.id,
    metadata: {
      requestId,
      policy: endpoint.snapshot.endpointAccessPolicy,
      caller: {
        subject: caller.subject ?? null,
        permissions: caller.permissions,
      },
    },
  });
}

export type AppliedHttpResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
};
export function applyHttpResponseMapping(
  output: unknown,
  mapping: Record<string, unknown> | null | undefined,
  requestId: string,
): AppliedHttpResponse {
  if (!mapping || Object.keys(mapping).length === 0)
    return { statusCode: 200, headers: {}, body: output };
  const structured =
    Object.hasOwn(mapping, "body") ||
    Object.hasOwn(mapping, "statusCode") ||
    Object.hasOwn(mapping, "headers");
  const bodySpec = structured ? mapping.body : mapping;
  const body =
    bodySpec === undefined
      ? output
      : typeof bodySpec === "string"
        ? resolveOutputPath(output, bodySpec, requestId)
        : mapResponseObject(output, bodySpec, requestId);
  const statusCode = mapping.statusCode === undefined ? 200 : mapping.statusCode;
  if (
    !Number.isInteger(statusCode) ||
    Number(statusCode) < 100 ||
    Number(statusCode) > 599
  )
    throw configurationError(
      "HTTP response statusCode must be an integer from 100 through 599.",
      requestId,
    );
  const headers: Record<string, string> = {};
  if (mapping.headers !== undefined) {
    if (
      !mapping.headers ||
      typeof mapping.headers !== "object" ||
      Array.isArray(mapping.headers)
    )
      throw configurationError(
        "HTTP response headers mapping must be an object.",
        requestId,
      );
    for (const [name, expression] of Object.entries(mapping.headers)) {
      if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || typeof expression !== "string")
        throw configurationError("HTTP response header mapping is invalid.", requestId);
      const value = String(resolveOutputPath(output, expression, requestId));
      if (/[\r\n]/.test(value))
        throw configurationError(
          "HTTP response header values cannot contain line breaks.",
          requestId,
        );
      headers[name] = value;
    }
  }
  return { statusCode: Number(statusCode), headers, body };
}
function mapResponseObject(
  output: unknown,
  spec: unknown,
  requestId: string,
): Record<string, unknown> {
  if (!spec || typeof spec !== "object" || Array.isArray(spec))
    throw configurationError(
      "HTTP response body mapping must be a path or object.",
      requestId,
    );
  const mapped: Record<string, unknown> = {};
  for (const [target, expression] of Object.entries(spec)) {
    if (typeof expression !== "string" || !target)
      throw configurationError(
        "HTTP response body mapping entries must be output paths.",
        requestId,
      );
    mapped[target] = resolveOutputPath(output, expression, requestId);
  }
  return mapped;
}
function resolveOutputPath(
  output: unknown,
  expression: string,
  requestId: string,
): unknown {
  const normalized = expression
    .trim()
    .replace(/^\$\.?/, "")
    .replace(/^output\.?/, "");
  if (!normalized) return output;
  let current: unknown = output;
  for (const part of normalized.split(".")) {
    if (
      !current ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !Object.hasOwn(current, part)
    )
      throw configurationError(
        `HTTP response mapping path '${expression}' was not present in function output.`,
        requestId,
      );
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
function configurationError(message: string, requestId: string) {
  return new SafeRuntimeError({
    code: "CONFIGURATION_ERROR",
    message,
    requestId,
  });
}
function requestAbortSignal(request: FastifyRequest): AbortSignal {
  const controller = new AbortController();
  if (request.raw.aborted) controller.abort();
  else request.raw.once("aborted", () => controller.abort());
  return controller.signal;
}
export function normalizeTestSource(value: unknown): "mcp" | "http" | undefined {
  return value === "mcp" || value === "http" ? value : undefined;
}

export function isPublicRuntimePath(path: string): boolean {
  return ["/mcp/", "/mcp-dev/", "/http/", "/http-dev/"].some((prefix) =>
    path.startsWith(prefix),
  );
}
