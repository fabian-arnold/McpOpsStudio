import { fork } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import {
  asSafeRuntimeError,
  SafeRuntimeError,
  type InternalRuntimeErrorShape,
  type RuntimeContext,
} from "@mcpops/runtime-sdk";

export type FunctionExecutionRequest = {
  compiledCode: string;
  input: unknown;
  context: RuntimeContext;
  timeoutMs: number;
  abortController?: AbortController;
};
export type FunctionExecutionResult = {
  status: "success" | "error" | "timeout";
  output?: unknown;
  error?: InternalRuntimeErrorShape;
  durationMs: number;
};
export type ExecutorMetadata = {
  provider: "local" | "container";
  isolation: "trusted-developer" | "disposable-container";
  runtime?: string;
  image?: string;
};
export interface FunctionExecutor {
  readonly metadata: ExecutorMetadata;
  execute(request: FunctionExecutionRequest): Promise<FunctionExecutionResult>;
}

type ChildMessage =
  | { type: "ready" }
  | { type: "result"; output: unknown }
  | {
      type: "error";
      error: {
        code?: string;
        message?: string;
        requestId?: string;
        retryable?: boolean;
        diagnostic?: InternalRuntimeErrorShape["diagnostic"];
      };
    }
  | { type: "rpc"; id: number; operation: string; args: unknown[] };

export class LocalChildProcessExecutor implements FunctionExecutor {
  readonly metadata: ExecutorMetadata = {
    provider: "local",
    isolation: "trusted-developer",
  };
  async execute(request: FunctionExecutionRequest): Promise<FunctionExecutionResult> {
    const startedAt = performance.now();
    const directory = await mkdtemp(join(tmpdir(), "mcpops-execution-"));
    const modulePath = join(directory, "function.mjs");
    await writeFile(modulePath, request.compiledCode, {
      encoding: "utf8",
      mode: 0o600,
    });
    const adjacentRunner = fileURLToPath(new URL("./runner.js", import.meta.url));
    const runnerPath = existsSync(adjacentRunner)
      ? adjacentRunner
      : fileURLToPath(new URL("../dist/runner.js", import.meta.url));
    const child = fork(runnerPath, [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { NODE_ENV: "production" },
      execArgv: [
        "--no-addons",
        "--disable-proto=delete",
        "--disallow-code-generation-from-strings",
      ],
    });
    const result = await new Promise<FunctionExecutionResult>((resolve) => {
      let settled = false;
      let cancellationResult: FunctionExecutionResult | undefined;
      let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: FunctionExecutionResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (cancellationTimer) clearTimeout(cancellationTimer);
        request.context.abortSignal.removeEventListener("abort", abort);
        child.kill("SIGKILL");
        resolve(value);
      };
      const timeoutResult = (): FunctionExecutionResult => ({
        status: "timeout",
        durationMs: Math.round(performance.now() - startedAt),
        error: new SafeRuntimeError({
          code: "TIMEOUT",
          message: "The function exceeded its time limit.",
          requestId: request.context.invocation.requestId,
        }).toJSON(),
      });
      const cancel = (): void => {
        if (settled || cancellationResult) return;
        cancellationResult = timeoutResult();
        request.abortController?.abort(
          new DOMException("Function execution cancelled", "AbortError"),
        );
        if (child.connected)
          child.send({
            type: "cancel",
            reason: "Function execution cancelled",
          });
        // Cooperative handlers get a short grace period to observe AbortSignal before hard termination.
        cancellationTimer = setTimeout(
          () => finish(cancellationResult as FunctionExecutionResult),
          1_000,
        );
      };
      const timer = setTimeout(cancel, Math.max(1, request.timeoutMs));
      const abort = (): void => cancel();
      request.context.abortSignal.addEventListener("abort", abort, {
        once: true,
      });
      child.on("message", (raw: ChildMessage) => {
        if (raw.type === "ready") {
          child.send({
            type: "execute",
            moduleUrl: pathToFileURL(modulePath).href,
            input: request.input,
            context: serializeContext(request.context),
          });
          if (cancellationResult)
            child.send({
              type: "cancel",
              reason: "Function execution cancelled",
            });
        } else if (raw.type === "rpc") {
          void dispatchCapability(request.context, raw.operation, raw.args).then(
            (value) =>
              child.connected && child.send({ type: "rpc-result", id: raw.id, value }),
            (error: unknown) =>
              child.connected &&
              child.send({
                type: "rpc-error",
                id: raw.id,
                error: asSafeRuntimeError(
                  error,
                  request.context.invocation.requestId,
                ).toDiagnosticJSON(),
              }),
          );
        } else if (raw.type === "result") {
          finish(
            cancellationResult ?? {
              status: "success",
              output: raw.output,
              durationMs: Math.round(performance.now() - startedAt),
            },
          );
        } else if (raw.type === "error") {
          if (cancellationResult) {
            finish(cancellationResult);
            return;
          }
          const error = normalizeChildError(
            raw.error,
            request.context.invocation.requestId,
          );
          finish({
            status: error.code === "TIMEOUT" ? "timeout" : "error",
            error: error.toDiagnosticJSON(),
            durationMs: Math.round(performance.now() - startedAt),
          });
        }
      });
      child.on("error", () =>
        finish({
          status: "error",
          durationMs: Math.round(performance.now() - startedAt),
          error: asSafeRuntimeError(
            undefined,
            request.context.invocation.requestId,
          ).toJSON(),
        }),
      );
      child.on("exit", () => {
        if (!settled)
          finish({
            status: "error",
            durationMs: Math.round(performance.now() - startedAt),
            error: asSafeRuntimeError(
              undefined,
              request.context.invocation.requestId,
            ).toJSON(),
          });
      });
    });
    await rm(directory, { recursive: true, force: true });
    return result;
  }
}

export async function dispatchCapability(
  context: RuntimeContext,
  operation: string,
  args: unknown[],
): Promise<unknown> {
  switch (operation) {
    case "logger.debug":
      context.logger.debug(String(args[0]), record(args[1]));
      return null;
    case "logger.info":
      context.logger.info(String(args[0]), record(args[1]));
      return null;
    case "logger.warn":
      context.logger.warn(String(args[0]), record(args[1]));
      return null;
    case "logger.error":
      context.logger.error(String(args[0]), record(args[1]));
      return null;
    case "http.request":
      return context.http.request(
        args[0] as Parameters<RuntimeContext["http"]["request"]>[0],
      );
    case "storage.get":
      return storageFor(context, args[1]).get(String(args[0]));
    case "storage.list":
      return storageFor(context, args[2]).list(
        String(args[0]),
        args[1] as { limit?: number } | undefined,
      );
    case "storage.set":
      return storageFor(context, args[3]).set(
        String(args[0]),
        args[1],
        args[2] as { ttlSeconds?: number } | undefined,
      );
    case "storage.delete":
      return storageFor(context, args[1]).delete(String(args[0]));
    case "storage.deleteMany":
      return storageFor(context, args[2]).deleteMany(
        String(args[0]),
        args[1] as { limit?: number } | undefined,
      );
    case "cache.get":
      return cacheFor(context, args[1]).get(String(args[0]));
    case "cache.set":
      return cacheFor(context, args[3]).set(
        String(args[0]),
        args[1],
        args[2] as { ttlSeconds?: number } | undefined,
      );
    case "cache.delete":
      return cacheFor(context, args[1]).delete(String(args[0]));
    case "audit.write":
      return context.audit.write(
        args[0] as Parameters<RuntimeContext["audit"]["write"]>[0],
      );
    case "db.query":
      return context.db.query(args[0] as Parameters<RuntimeContext["db"]["query"]>[0]);
    case "functions.call":
      return context.functions.call(String(args[0]), args[1]);
    default:
      throw new Error("Unknown execution capability");
  }
}

export function serializeContext(context: RuntimeContext): Record<string, unknown> {
  const secretNames = Object.keys(context.env).filter(() => false); // secret accessor intentionally has no enumeration API
  const grantedSecrets: Record<string, string> = {};
  // The runtime attaches the explicit grant list as a non-enumerable implementation detail.
  const grants =
    (
      context.secrets as RuntimeContext["secrets"] & {
        grantedNames?: readonly string[];
      }
    ).grantedNames ?? secretNames;
  for (const name of grants) grantedSecrets[name] = context.secrets.get(name);
  return {
    invocation: context.invocation,
    project: context.project,
    environment: context.environment,
    endpoint: context.endpoint,
    function: context.function,
    caller: context.caller,
    tenant: context.tenant,
    permissions: context.permissions,
    env: context.env,
    secrets: grantedSecrets,
  };
}
function storageFor(context: RuntimeContext, tenant: unknown) {
  return typeof tenant === "string"
    ? context.storage.forTenant(tenant)
    : context.storage;
}
function cacheFor(context: RuntimeContext, tenant: unknown) {
  return typeof tenant === "string" ? context.cache.forTenant(tenant) : context.cache;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function normalizeChildError(
  value: {
    code?: string;
    message?: string;
    requestId?: string;
    retryable?: boolean;
    diagnostic?: InternalRuntimeErrorShape["diagnostic"];
  },
  fallbackRequestId: string,
): SafeRuntimeError {
  const allowed = new Set([
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "VALIDATION_ERROR",
    "RATE_LIMITED",
    "TIMEOUT",
    "UPSTREAM_ERROR",
    "CONFIGURATION_ERROR",
    "INTERNAL_ERROR",
  ]);
  const code = allowed.has(value.code ?? "")
    ? (value.code as SafeRuntimeError["code"])
    : "INTERNAL_ERROR";
  const message =
    code === "INTERNAL_ERROR"
      ? "The function could not be completed."
      : String(value.message ?? "The function could not be completed.");
  return new SafeRuntimeError({
    code,
    message,
    requestId: value.requestId ?? fallbackRequestId,
    ...(value.retryable === undefined ? {} : { retryable: value.retryable }),
    ...(value.diagnostic === undefined ? {} : { diagnostic: value.diagnostic }),
  });
}
