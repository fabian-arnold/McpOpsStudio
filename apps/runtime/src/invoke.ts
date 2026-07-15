import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import {
  PolicyHttpClient,
  decryptSecret,
  type FunctionExecutor,
} from "@mcpops/sandbox";
import {
  asSafeRuntimeError,
  authorizePermissions,
  redactSensitive,
  SafeRuntimeError,
  type CallerIdentity,
  type RuntimeContext,
} from "@mcpops/runtime-sdk";
import type {
  HttpBinding,
  LoadedEndpoint,
  McpBinding,
  SnapshotFunction,
} from "./domain.js";
import {
  getEncryptedSecret,
  getEncryptedSecretById,
  saveAudit,
  saveExecution,
  saveRuntimeLogs,
} from "./repository.js";
import type { RuntimeMetrics } from "./metrics.js";
import {
  DatabaseStorage,
  GrantedSecrets,
  InvocationAudit,
  InvocationLogger,
  RedisCache,
  linkAbortSignal,
  normalizeCachePolicy,
  validateAgainstSchema,
} from "./invocation-adapters.js";
import {
  capturedPayload,
  payloadCaptureDisabled,
  shouldCapturePayloads,
} from "./invocation-payloads.js";
import {
  PostgresReviewedQueryAdapter,
  reviewedQueriesEnabled,
  SnapshotReviewedDatabase,
  type ReviewedQueryAdapter,
} from "./reviewed-database.js";
import { SnapshotCollections } from "./collections.js";

export {
  buildRuntimeLogEvent,
  normalizeCachePolicy,
  shouldWriteLog,
  validateAgainstSchema,
} from "./invocation-adapters.js";
export { capturedPayload, shouldCapturePayloads } from "./invocation-payloads.js";

export type InvokeRequest = {
  endpoint: LoadedEndpoint;
  fn: SnapshotFunction;
  source: "mcp" | "http" | "test" | "internal";
  input: unknown;
  caller: CallerIdentity;
  requestId: string;
  correlationId?: string;
  tenantId?: string;
  simulatedSource?: "mcp" | "http";
  abortSignal?: AbortSignal;
  outputTransformer?: (output: unknown) => unknown;
  mcpBinding?: McpBinding;
  httpBinding?: HttpBinding;
  parentExecutionId?: string;
  rootExecutionId?: string;
  internalDepth?: number;
  deadlineAt?: number;
  skipPermissionAuthorization?: boolean;
};
export type RuntimeLogEvent = {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: unknown;
  metadata?: unknown;
  requestId: string;
  executionId: string;
  correlationId?: string;
  projectId: string;
  environmentId: string;
  endpointId: string;
  functionId: string;
  deploymentId: string;
  callerSubject?: string;
};
export type InvokeResult =
  | {
      ok: true;
      output: unknown;
      durationMs: number;
      executionId: string;
      logs: RuntimeLogEvent[];
    }
  | {
      ok: false;
      error: SafeRuntimeError;
      durationMs: number;
      executionId: string;
      logs: RuntimeLogEvent[];
    };

export class RuntimeInvoker {
  private readonly redis: Redis;
  constructor(
    redisUrl: string,
    private readonly masterKey: Buffer,
    private readonly metrics: RuntimeMetrics,
    private readonly executor: FunctionExecutor,
    private readonly reviewedQueryAdapter: ReviewedQueryAdapter = new PostgresReviewedQueryAdapter(),
  ) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }

  async invoke(request: InvokeRequest): Promise<InvokeResult> {
    const started = performance.now();
    const executionId = randomUUID();
    const logs: RuntimeLogEvent[] = [];
    const controller = new AbortController();
    const unlinkAbort = linkAbortSignal(request.abortSignal, controller);
    let executionStatus: string;
    let output: unknown;
    let recordedError: unknown;
    let secretValues: readonly string[] = [];
    try {
      if (!request.skipPermissionAuthorization)
        authorizePermissions(
          request.caller,
          request.fn.requiredPermissions,
          request.requestId,
        );
      validateAgainstSchema(
        request.fn.inputSchema,
        request.input,
        request.requestId,
        "input",
      );
      const secrets = await this.loadSecrets(
        request.endpoint,
        request.fn,
        request.requestId,
      );
      secretValues = secrets.values();
      const context = this.context(
        request,
        executionId,
        logs,
        controller.signal,
        secrets,
      );
      const execution = await this.executor.execute({
        compiledCode: request.fn.compiledCode,
        input: request.input,
        context,
        timeoutMs: Math.max(
          1,
          Math.min(
            request.fn.timeoutMs,
            (request.deadlineAt ?? Date.now() + request.fn.timeoutMs) - Date.now(),
          ),
        ),
        abortController: controller,
      });
      if (execution.status !== "success")
        throw new SafeRuntimeError(
          execution.error ?? {
            code: "INTERNAL_ERROR",
            message: "The function could not be completed.",
            requestId: request.requestId,
          },
        );
      output = execution.output ?? null;
      if (request.fn.outputSchema)
        validateAgainstSchema(
          request.fn.outputSchema,
          output,
          request.requestId,
          "output",
        );
      const responseOutput = request.outputTransformer
        ? request.outputTransformer(output)
        : output;
      executionStatus = "success";
      const durationMs = Math.round(performance.now() - started);
      await this.record(
        request,
        executionId,
        executionStatus,
        durationMs,
        output,
        undefined,
        secretValues,
        logs,
      );
      this.metrics.record(executionStatus, durationMs);
      return {
        ok: true,
        output: responseOutput,
        durationMs,
        executionId,
        logs,
      };
    } catch (error) {
      const safe = asSafeRuntimeError(error, request.requestId);
      executionStatus =
        safe.code === "FORBIDDEN"
          ? "denied"
          : safe.code === "TIMEOUT"
            ? "timeout"
            : safe.code === "VALIDATION_ERROR"
              ? "validation_error"
              : "error";
      recordedError = safe.toJSON();
      const durationMs = Math.round(performance.now() - started);
      await this.record(
        request,
        executionId,
        executionStatus,
        durationMs,
        undefined,
        recordedError,
        secretValues,
        logs,
      );
      this.metrics.record(executionStatus, durationMs);
      return { ok: false, error: safe, durationMs, executionId, logs };
    } finally {
      unlinkAbort();
    }
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
  async probeCache(): Promise<void> {
    const response = await this.redis.ping();
    if (response !== "PONG") throw new Error("Redis readiness probe failed");
  }
  async claimReplay(key: string, ttlSeconds: number): Promise<boolean> {
    return (
      (await this.redis.set(key, "1", "EX", Math.max(1, ttlSeconds), "NX")) === "OK"
    );
  }

  private async loadSecrets(
    endpoint: LoadedEndpoint,
    fn: SnapshotFunction,
    requestId: string,
  ): Promise<GrantedSecrets> {
    const values = new Map<string, string>();
    for (const name of fn.secretGrants) {
      const encrypted = await getEncryptedSecret(endpoint, name);
      if (!encrypted)
        throw new SafeRuntimeError({
          code: "CONFIGURATION_ERROR",
          message: `A granted secret is not configured: ${name}.`,
          requestId,
        });
      try {
        values.set(name, decryptSecret(encrypted, this.masterKey));
      } catch {
        throw new SafeRuntimeError({
          code: "CONFIGURATION_ERROR",
          message: "A granted secret could not be loaded.",
          requestId,
        });
      }
    }
    return new GrantedSecrets(values, requestId);
  }

  private context(
    request: InvokeRequest,
    executionId: string,
    logs: RuntimeLogEvent[],
    abortSignal: AbortSignal,
    secrets: GrantedSecrets,
  ): RuntimeContext {
    const scope = `${request.endpoint.project.id}:${request.endpoint.environment.id}:${request.fn.functionId}`;
    const logger = new InvocationLogger(request, executionId, logs, secrets.values());
    const audit = new InvocationAudit(request);
    const base = {
      invocation: {
        source: request.source,
        requestId: request.requestId,
        ...(request.correlationId ? { correlationId: request.correlationId } : {}),
        ...(request.simulatedSource
          ? { simulatedSource: request.simulatedSource }
          : {}),
      },
      project: request.endpoint.project,
      environment: request.endpoint.environment,
      endpoint: {
        id: request.endpoint.id,
        slug: request.endpoint.slug,
        name: request.endpoint.name,
        kind: request.endpoint.kind,
      },
      function: {
        id: request.fn.functionId,
        name: request.fn.name,
        riskLevel: request.fn.riskLevel,
      },
      caller: request.caller,
      permissions: request.caller.permissions,
      env: request.endpoint.snapshot.env,
      secrets,
      logger,
      http: new PolicyHttpClient(
        request.endpoint.snapshot.networkPolicy,
        request.requestId,
        abortSignal,
      ),
      storage: new DatabaseStorage(request.endpoint, request.fn.functionId),
      cache: new RedisCache(
        this.redis,
        scope,
        "_",
        normalizeCachePolicy(request.fn.cachePolicy),
      ),
      audit,
      db: new SnapshotReviewedDatabase({
        enabled: reviewedQueriesEnabled(
          process.env,
          request.endpoint.snapshot.capabilities.reviewedDatabaseQueries.enabled,
        ),
        functionId: request.fn.functionId,
        definitions: request.endpoint.snapshot.reviewedQueries,
        requestId: request.requestId,
        abortSignal,
        resolveConnectionSecret: async (secretId) => {
          const encrypted = await getEncryptedSecretById(request.endpoint, secretId);
          if (!encrypted)
            throw new SafeRuntimeError({
              code: "CONFIGURATION_ERROR",
              message: "The reviewed database connection is not configured.",
              requestId: request.requestId,
            });
          try {
            return decryptSecret(encrypted, this.masterKey);
          } catch {
            throw new SafeRuntimeError({
              code: "CONFIGURATION_ERROR",
              message: "The reviewed database connection could not be loaded.",
              requestId: request.requestId,
            });
          }
        },
        adapter: this.reviewedQueryAdapter,
        logger,
        audit,
      }),
      collections: new SnapshotCollections(
        request.endpoint,
        request.fn.functionId,
        request.tenantId,
        request.requestId,
        secrets.values(),
      ),
      functions: {
        call: async (slug: string, input: unknown): Promise<unknown> => {
          const depth = request.internalDepth ?? 0;
          if (depth >= 8)
            throw new SafeRuntimeError({
              code: "CONFIGURATION_ERROR",
              message: "The internal function call depth limit was exceeded.",
              requestId: request.requestId,
            });
          const edge = request.endpoint.snapshot.functionCalls.find(
            (call) =>
              call.callerFunctionId === request.fn.functionId &&
              call.calleeSlug === slug,
          );
          const callee = edge
            ? request.endpoint.snapshot.functions.find(
                (fn) => fn.functionId === edge.calleeFunctionId,
              )
            : undefined;
          if (!callee)
            throw new SafeRuntimeError({
              code: "CONFIGURATION_ERROR",
              message:
                "The requested internal Function is not available in this deployment.",
              requestId: request.requestId,
            });
          const child = await this.invoke({
            endpoint: request.endpoint,
            fn: callee,
            source: "internal",
            input,
            caller: request.caller,
            requestId: randomUUID(),
            ...(request.correlationId ? { correlationId: request.correlationId } : {}),
            ...(request.tenantId ? { tenantId: request.tenantId } : {}),
            abortSignal,
            parentExecutionId: executionId,
            rootExecutionId: request.rootExecutionId ?? executionId,
            internalDepth: depth + 1,
            deadlineAt: request.deadlineAt ?? Date.now() + request.fn.timeoutMs,
            skipPermissionAuthorization: true,
          });
          if (!child.ok) throw child.error;
          return child.output;
        },
      },
      abortSignal,
    } satisfies RuntimeContext;
    return request.tenantId ? { ...base, tenant: { id: request.tenantId } } : base;
  }

  private async record(
    request: InvokeRequest,
    executionId: string,
    status: string,
    durationMs: number,
    output: unknown,
    error: unknown,
    secrets: readonly string[],
    logs: readonly RuntimeLogEvent[],
  ): Promise<void> {
    const capturePayloads = shouldCapturePayloads(request.endpoint.environment);
    await saveExecution({
      id: executionId,
      projectId: request.endpoint.project.id,
      endpointId: request.endpoint.id,
      functionId: request.fn.functionId,
      functionVersionId: request.fn.versionId,
      ...(request.mcpBinding ? { mcpToolBindingId: request.mcpBinding.id } : {}),
      ...(request.httpBinding ? { httpRouteBindingId: request.httpBinding.id } : {}),
      deploymentId: request.endpoint.deployment.id,
      requestId: request.requestId,
      ...(request.correlationId ? { correlationId: request.correlationId } : {}),
      invocationSource: request.source,
      callerIdentity: redactSensitive(request.caller, secrets),
      input: capturePayloads
        ? capturedPayload(request.input, secrets)
        : payloadCaptureDisabled,
      ...(output === undefined
        ? {}
        : {
            output: capturePayloads
              ? capturedPayload(output, secrets)
              : payloadCaptureDisabled,
          }),
      ...(error === undefined ? {} : { error: redactSensitive(error, secrets) }),
      durationMs,
      status,
      ...(request.parentExecutionId
        ? { parentExecutionId: request.parentExecutionId }
        : {}),
      rootExecutionId: request.rootExecutionId ?? executionId,
    });
    await saveRuntimeLogs(request.endpoint, logs).catch(() => {
      process.stderr.write("Runtime log persistence failed.\n");
    });
    if (status === "denied" || status === "success")
      await saveAudit({
        projectId: request.endpoint.project.id,
        environmentId: request.endpoint.environment.id,
        endpointId: request.endpoint.id,
        functionId: request.fn.functionId,
        actorType: "caller",
        ...(request.caller.subject ? { actorId: request.caller.subject } : {}),
        action:
          status === "denied" ? "function.invoke.denied" : "function.invoke.succeeded",
        targetType: "function",
        targetId: request.fn.functionId,
        metadata: {
          requestId: request.requestId,
          executionId,
          source: request.source,
          ...(request.simulatedSource
            ? { simulatedSource: request.simulatedSource }
            : {}),
          riskLevel: request.fn.riskLevel,
          deploymentVersion: request.endpoint.deployment.version,
        },
      });
  }
}
