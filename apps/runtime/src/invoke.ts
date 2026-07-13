import { Ajv, type ValidateFunction } from "ajv";
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
  type AuditWriter,
  type CallerIdentity,
  type RuntimeContext,
  type SafeLogger,
  type ScopedCache,
  type ScopedStorage,
  type SecretAccessor,
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
  storageDelete,
  storageGet,
  storageSet,
} from "./repository.js";
import type { RuntimeMetrics } from "./metrics.js";
import {
  PostgresReviewedQueryAdapter,
  reviewedQueriesEnabled,
  SnapshotReviewedDatabase,
  type ReviewedQueryAdapter,
} from "./reviewed-database.js";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  removeAdditional: false,
  coerceTypes: true,
});

const payloadCaptureDisabled = {
  captured: false,
  reason: "Development payload capture is disabled",
};
const maxCapturedPayloadBytes = 64 * 1024;

export function shouldCapturePayloads(environment: {
  slug: string;
  capturePayloads?: boolean;
}): boolean {
  return (
    environment.slug === "development" && environment.capturePayloads === true
  );
}

export function capturedPayload(
  value: unknown,
  secrets: readonly string[] = [],
): unknown {
  const redacted = redactSensitive(value, secrets);
  const serialized = JSON.stringify(redacted);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= maxCapturedPayloadBytes) return redacted;
  return {
    captured: true,
    truncated: true,
    originalBytes: bytes,
    preview: serialized.slice(0, 16_000),
  };
}

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
    let executionStatus = "error";
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
            (request.deadlineAt ?? Date.now() + request.fn.timeoutMs) -
              Date.now(),
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
      (await this.redis.set(key, "1", "EX", Math.max(1, ttlSeconds), "NX")) ===
      "OK"
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
    const logger = new InvocationLogger(
      request,
      executionId,
      logs,
      secrets.values(),
    );
    const audit = new InvocationAudit(request);
    const base = {
      invocation: {
        source: request.source,
        requestId: request.requestId,
        ...(request.correlationId
          ? { correlationId: request.correlationId }
          : {}),
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
          const encrypted = await getEncryptedSecretById(
            request.endpoint,
            secretId,
          );
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
            ...(request.correlationId
              ? { correlationId: request.correlationId }
              : {}),
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
    return request.tenantId
      ? { ...base, tenant: { id: request.tenantId } }
      : base;
  }

  private async record(
    request: InvokeRequest,
    executionId: string,
    status: string,
    durationMs: number,
    output: unknown,
    error: unknown,
    secrets: readonly string[],
  ): Promise<void> {
    const capturePayloads = shouldCapturePayloads(
      request.endpoint.environment,
    );
    await saveExecution({
      id: executionId,
      projectId: request.endpoint.project.id,
      endpointId: request.endpoint.id,
      functionId: request.fn.functionId,
      functionVersionId: request.fn.versionId,
      ...(request.mcpBinding
        ? { mcpToolBindingId: request.mcpBinding.id }
        : {}),
      ...(request.httpBinding
        ? { httpRouteBindingId: request.httpBinding.id }
        : {}),
      deploymentId: request.endpoint.deployment.id,
      requestId: request.requestId,
      ...(request.correlationId
        ? { correlationId: request.correlationId }
        : {}),
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
      ...(error === undefined
        ? {}
        : { error: redactSensitive(error, secrets) }),
      durationMs,
      status,
      ...(request.parentExecutionId
        ? { parentExecutionId: request.parentExecutionId }
        : {}),
      rootExecutionId: request.rootExecutionId ?? executionId,
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
          status === "denied"
            ? "function.invoke.denied"
            : "function.invoke.succeeded",
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

class GrantedSecrets implements SecretAccessor {
  readonly grantedNames: readonly string[];
  constructor(
    private readonly entries: Map<string, string>,
    private readonly requestId: string,
  ) {
    this.grantedNames = [...entries.keys()];
  }
  get(name: string): string {
    const value = this.entries.get(name);
    if (value === undefined)
      throw new SafeRuntimeError({
        code: "CONFIGURATION_ERROR",
        message: "The requested secret is not granted.",
        requestId: this.requestId,
      });
    return value;
  }
  values(): string[] {
    return [...this.entries.values()];
  }
}
class InvocationLogger implements SafeLogger {
  constructor(
    private readonly request: InvokeRequest,
    private readonly executionId: string,
    private readonly events: RuntimeLogEvent[],
    private readonly secrets: readonly string[],
  ) {}
  debug(message: string, metadata?: Record<string, unknown>): void {
    this.write("debug", message, metadata);
  }
  info(message: string, metadata?: Record<string, unknown>): void {
    this.write("info", message, metadata);
  }
  warn(message: string, metadata?: Record<string, unknown>): void {
    this.write("warn", message, metadata);
  }
  error(message: string, metadata?: Record<string, unknown>): void {
    this.write("error", message, metadata);
  }
  private write(
    level: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): void {
    const event = buildRuntimeLogEvent(
      this.request,
      this.executionId,
      level as RuntimeLogEvent["level"],
      message,
      metadata,
      this.secrets,
    );
    this.events.push(event);
    process.stdout.write(JSON.stringify(event) + "\n");
  }
}
export function buildRuntimeLogEvent(
  request: InvokeRequest,
  executionId: string,
  level: RuntimeLogEvent["level"],
  message: string,
  metadata: Record<string, unknown> | undefined,
  secrets: readonly string[],
): RuntimeLogEvent {
  return {
    timestamp: new Date().toISOString(),
    level,
    message: redactSensitive(message, secrets),
    ...(metadata === undefined
      ? {}
      : { metadata: redactSensitive(metadata, secrets) }),
    requestId: request.requestId,
    executionId,
    projectId: request.endpoint.project.id,
    environmentId: request.endpoint.environment.id,
    endpointId: request.endpoint.id,
    functionId: request.fn.functionId,
    deploymentId: request.endpoint.deployment.id,
    ...(request.caller.subject
      ? { callerSubject: request.caller.subject }
      : {}),
  };
}
class DatabaseStorage implements ScopedStorage {
  constructor(
    private readonly endpoint: LoadedEndpoint,
    private readonly functionId: string,
    private readonly tenantScope = "_",
  ) {}
  get(key: string): Promise<unknown> {
    return storageGet(
      this.endpoint,
      this.functionId,
      this.tenantScope,
      safeKey(key),
    );
  }
  set(
    key: string,
    value: unknown,
    options?: { ttlSeconds?: number },
  ): Promise<void> {
    return storageSet(
      this.endpoint,
      this.functionId,
      this.tenantScope,
      safeKey(key),
      value,
      options?.ttlSeconds,
    );
  }
  delete(key: string): Promise<void> {
    return storageDelete(
      this.endpoint,
      this.functionId,
      this.tenantScope,
      safeKey(key),
    );
  }
  forTenant(tenantId: string): ScopedStorage {
    return new DatabaseStorage(
      this.endpoint,
      this.functionId,
      safeTenant(tenantId),
    );
  }
}
class RedisCache implements ScopedCache {
  constructor(
    private readonly redis: Redis,
    private readonly scope: string,
    private readonly tenantScope = "_",
    private readonly policy: EffectiveCachePolicy = normalizeCachePolicy(null),
  ) {}
  async get(key: string): Promise<unknown> {
    const value = await this.redis.get(this.key(key));
    return value === null ? null : JSON.parse(value);
  }
  async set(
    key: string,
    value: unknown,
    options?: { ttlSeconds?: number },
  ): Promise<void> {
    await this.redis.set(
      this.key(key),
      JSON.stringify(value),
      "EX",
      this.ttl(options?.ttlSeconds),
    );
  }
  async delete(key: string): Promise<void> {
    await this.redis.del(this.key(key));
  }
  async getOrSet(
    key: string,
    producer: () => Promise<unknown>,
    options?: { ttlSeconds?: number },
  ): Promise<unknown> {
    const current = await this.get(key);
    if (current !== null) return current;
    const value = await producer();
    await this.set(key, value, options);
    return value;
  }
  forTenant(tenantId: string): ScopedCache {
    return new RedisCache(
      this.redis,
      this.scope,
      safeTenant(tenantId),
      this.policy,
    );
  }
  private key(key: string): string {
    return `mcpops:${this.scope}:${this.tenantScope}:${safeKey(key)}`;
  }
  private ttl(requested?: number): number {
    return Math.max(
      1,
      Math.min(
        requested ?? this.policy.defaultTtlSeconds,
        this.policy.maxTtlSeconds,
      ),
    );
  }
}
class InvocationAudit implements AuditWriter {
  constructor(private readonly request: InvokeRequest) {}
  async write(event: {
    action: string;
    targetType: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await saveAudit({
      projectId: this.request.endpoint.project.id,
      environmentId: this.request.endpoint.environment.id,
      endpointId: this.request.endpoint.id,
      functionId: this.request.fn.functionId,
      actorType: "caller",
      ...(this.request.caller.subject
        ? { actorId: this.request.caller.subject }
        : {}),
      action: event.action,
      targetType: event.targetType,
      ...(event.targetId ? { targetId: event.targetId } : {}),
      metadata: redactSensitive(event.metadata ?? {}),
    });
  }
}
function validate(
  validateFn: ValidateFunction,
  value: unknown,
  requestId: string,
  kind: "input" | "output",
): void {
  if (!validateFn(value))
    throw new SafeRuntimeError({
      code: kind === "input" ? "VALIDATION_ERROR" : "INTERNAL_ERROR",
      message:
        kind === "input"
          ? "The function input is invalid."
          : "The function returned an invalid response.",
      requestId,
    });
}
export function validateAgainstSchema(
  schema: object,
  value: unknown,
  requestId: string,
  kind: "input" | "output" = "input",
): void {
  validate(ajv.compile(schema), value, requestId, kind);
}
export type EffectiveCachePolicy = {
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
};
export function normalizeCachePolicy(
  policy: SnapshotFunction["cachePolicy"],
): EffectiveCachePolicy {
  const defaultTtlSeconds =
    policy?.defaultTtlSeconds ?? policy?.ttlSeconds ?? 300;
  const maxTtlSeconds = policy?.maxTtlSeconds ?? 86_400;
  return {
    defaultTtlSeconds: Math.min(defaultTtlSeconds, maxTtlSeconds),
    maxTtlSeconds,
  };
}
function linkAbortSignal(
  source: AbortSignal | undefined,
  target: AbortController,
): () => void {
  if (!source) return () => undefined;
  const abort = () => target.abort(source.reason);
  if (source.aborted) abort();
  else source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}
function safeKey(value: string): string {
  if (!value || value.length > 512 || /[\u0000-\u001f]/.test(value))
    throw new Error("Invalid storage key");
  return value;
}
function safeTenant(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value))
    throw new Error("Invalid tenant scope");
  return value;
}
