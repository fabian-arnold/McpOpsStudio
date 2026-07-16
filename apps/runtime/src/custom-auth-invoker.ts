import type { FastifyRequest } from "fastify";
import { SafeRuntimeError } from "@mcpops/runtime-sdk";
import type { LoadedEndpoint } from "./domain.js";
import type { RuntimeInvoker } from "./invoke.js";
import { findFunction, requestAbortSignal } from "./server-utils.js";

export function customAuthenticationInvoker(
  request: FastifyRequest,
  endpoint: LoadedEndpoint,
  invoker: RuntimeInvoker,
) {
  return async (functionId: string, input: unknown): Promise<unknown> => {
    const fn = findFunction(endpoint, functionId);
    if (!fn?.enabled)
      throw configuration(
        request.id,
        "The custom authentication Function is unavailable.",
      );
    const result = await invoker.invoke({
      endpoint,
      fn,
      source: "internal",
      input,
      caller: {
        subject: `auth-policy-function:${functionId}`,
        permissions: [],
        claims: { authentication: "platform" },
      },
      requestId: request.id,
      abortSignal: requestAbortSignal(request),
      skipPermissionAuthorization: true,
      suppressPayloadCapture: true,
      suppressLogs: true,
    });
    if (!result.ok)
      throw configuration(
        request.id,
        "The custom authentication Function could not be completed.",
        result.error.retryable,
      );
    return result.output;
  };
}

function configuration(
  requestId: string,
  message: string,
  retryable = false,
): SafeRuntimeError {
  return new SafeRuntimeError({
    code: "CONFIGURATION_ERROR",
    message,
    requestId,
    ...(retryable ? { retryable: true } : {}),
  });
}
