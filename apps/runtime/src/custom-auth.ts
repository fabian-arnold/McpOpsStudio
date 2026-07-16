import type { FastifyRequest } from "fastify";
import {
  customAuthInputSchema,
  customAuthResultSchema,
  customFunctionPolicyConfigSchema,
} from "@mcpops/shared";
import { SafeRuntimeError, type CallerIdentity } from "@mcpops/runtime-sdk";
import type { AuthPolicy, LoadedEndpoint } from "./domain.js";

export async function authenticateCustomFunction(
  request: FastifyRequest,
  endpoint: LoadedEndpoint,
  policy: AuthPolicy,
  invoke?: (functionId: string, input: unknown) => Promise<unknown>,
): Promise<CallerIdentity> {
  const config = customFunctionPolicyConfigSchema.safeParse(policy.config);
  if (!config.success || !invoke) configuration(request.id);
  const input = customAuthInputSchema.parse({
    request: {
      method: request.method,
      path: request.url.split("?", 1)[0] ?? request.url,
      headers: requestHeaders(request),
      query: requestQuery(request),
      ...(request.body === undefined ? {} : { body: request.body }),
    },
    endpoint: { id: endpoint.id, kind: endpoint.kind, slug: endpoint.slug },
  });
  const result = customAuthResultSchema.safeParse(
    await invoke(config.data.functionId, input),
  );
  if (!result.success)
    configuration(
      request.id,
      "The custom authentication function returned an invalid result.",
    );
  if (!result.data.authenticated) unauthenticated(request.id);
  return {
    subject: result.data.subject as string,
    permissions: result.data.permissions,
    ...(result.data.tenantId ? { tenantId: result.data.tenantId } : {}),
    ...(result.data.name ? { name: result.data.name } : {}),
    ...(result.data.email ? { email: result.data.email } : {}),
    claims: {
      authentication: "custom_function",
      authenticationPolicyId: policy.id,
    },
  };
}

function requestHeaders(request: FastifyRequest): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name === "x-internal-token") continue;
    headers[name] = Array.isArray(value) ? value.map(String) : String(value);
  }
  return headers;
}

function requestQuery(request: FastifyRequest): Record<string, string | string[]> {
  const query = new URL(request.url, "http://runtime.invalid").searchParams;
  const result: Record<string, string | string[]> = {};
  for (const key of new Set(query.keys())) {
    const values = query.getAll(key);
    result[key] = values.length === 1 ? (values[0] as string) : values;
  }
  return result;
}

function unauthenticated(requestId: string): never {
  throw new SafeRuntimeError({
    code: "UNAUTHENTICATED",
    message: "Authentication is required.",
    requestId,
  });
}

function configuration(
  requestId: string,
  message = "The custom authentication policy is invalid.",
): never {
  throw new SafeRuntimeError({ code: "CONFIGURATION_ERROR", message, requestId });
}
