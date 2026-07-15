import type { FastifyReply, FastifyRequest } from "fastify";
import { SafeRuntimeError, type CallerIdentity } from "@mcpops/runtime-sdk";
import type { HttpBinding, LoadedEndpoint, SnapshotFunction } from "./domain.js";
import { loadEndpoint, saveAudit } from "./repository.js";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
};

export async function resolveEndpoint(
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
export function runtimeRequestHost(request: FastifyRequest): string | undefined {
  const forwarded = request.headers["x-forwarded-host"];
  return typeof forwarded === "string"
    ? forwarded.split(",", 1)[0]?.trim()
    : request.headers.host;
}
export function findFunction(
  endpoint: LoadedEndpoint,
  id: string,
): SnapshotFunction | undefined {
  return endpoint.snapshot.functions.find((fn) => fn.functionId === id || fn.id === id);
}
export function parseRpc(value: unknown): JsonRpcRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return row.jsonrpc === "2.0" && typeof row.method === "string"
    ? (row as JsonRpcRequest)
    : null;
}
export function rpcResponse(request: JsonRpcRequest, result: unknown) {
  return { jsonrpc: "2.0", id: request.id ?? null, result };
}
export function jsonRpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  requestId: string,
) {
  return { jsonrpc: "2.0", id, error: { code, message, data: { requestId } } };
}
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
export function requestValue(value: unknown): unknown {
  return value ?? {};
}
export function correlation(request: FastifyRequest): string | undefined {
  return stringHeader(request, "x-correlation-id");
}
export function stringHeader(
  request: FastifyRequest,
  header: string,
): string | undefined {
  const value = request.headers[header];
  return typeof value === "string" && value.length <= 256 ? value : undefined;
}

export function matchHttpBinding(
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
export function statusFor(code: SafeRuntimeError["code"]): number {
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
export function sendError(
  reply: FastifyReply,
  error: ReturnType<SafeRuntimeError["toJSON"]> | SafeRuntimeError,
) {
  const shape = "toJSON" in error ? error.toJSON() : error;
  return reply.code(statusFor(shape.code)).send({ error: shape });
}
export async function auditAuthDenial(
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
export async function auditEndpointAccessDenial(
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
export function requestAbortSignal(request: FastifyRequest): AbortSignal {
  const controller = new AbortController();
  if (request.raw.aborted) controller.abort();
  else request.raw.once("aborted", () => controller.abort());
  return controller.signal;
}
export function normalizeTestSource(
  value: unknown,
): "mcp" | "http" | "cron" | undefined {
  return value === "mcp" || value === "http" || value === "cron" ? value : undefined;
}

export function isPublicRuntimePath(path: string): boolean {
  return ["/mcp/", "/mcp-dev/", "/http/", "/http-dev/"].some((prefix) =>
    path.startsWith(prefix),
  );
}
