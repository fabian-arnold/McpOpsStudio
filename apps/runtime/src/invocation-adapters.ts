import { Ajv, type ValidateFunction } from "ajv";
import type { Redis } from "ioredis";
import {
  redactSensitive,
  SafeRuntimeError,
  type AuditWriter,
  type SafeLogger,
  type ScopedCache,
  type ScopedStorage,
  type SecretAccessor,
} from "@mcpops/runtime-sdk";
import type { LoadedEndpoint, SnapshotFunction } from "./domain.js";
import type { InvokeRequest, RuntimeLogEvent } from "./invoke.js";
import {
  saveAudit,
  storageDelete,
  storageDeleteMany,
  storageGet,
  storageList,
  storageSet,
} from "./repository.js";

const ajv = new Ajv({ allErrors: true, strict: false });

export class GrantedSecrets implements SecretAccessor {
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
export class InvocationLogger implements SafeLogger {
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
    level: RuntimeLogEvent["level"],
    message: string,
    metadata?: Record<string, unknown>,
  ): void {
    if (!shouldWriteLog(this.request.endpoint.environment.logLevel, level)) return;
    const event = buildRuntimeLogEvent(
      this.request,
      this.executionId,
      level,
      message,
      metadata,
      this.secrets,
    );
    this.events.push(event);
    process.stdout.write(JSON.stringify(event) + "\n");
  }
}
export function shouldWriteLog(
  configured: LoadedEndpoint["environment"]["logLevel"],
  level: RuntimeLogEvent["level"],
): boolean {
  const rank = { debug: 10, info: 20, warn: 30, error: 40, off: 50 } as const;
  return rank[level] >= rank[configured];
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
    ...(metadata === undefined ? {} : { metadata: redactSensitive(metadata, secrets) }),
    requestId: request.requestId,
    executionId,
    ...(request.correlationId ? { correlationId: request.correlationId } : {}),
    projectId: request.endpoint.project.id,
    environmentId: request.endpoint.environment.id,
    endpointId: request.endpoint.id,
    functionId: request.fn.functionId,
    deploymentId: request.endpoint.deployment.id,
    ...(request.caller.subject ? { callerSubject: request.caller.subject } : {}),
  };
}
export class DatabaseStorage implements ScopedStorage {
  constructor(
    private readonly endpoint: LoadedEndpoint,
    private readonly functionId: string,
    private readonly tenantScope = "_",
  ) {}
  get(key: string): Promise<unknown> {
    return storageGet(this.endpoint, this.functionId, this.tenantScope, safeKey(key));
  }
  list(
    pattern: string,
    options?: { limit?: number },
  ): Promise<Array<{ key: string; value: unknown }>> {
    return storageList(
      this.endpoint,
      this.functionId,
      this.tenantScope,
      safeStoragePattern(pattern),
      safeStorageLimit(options?.limit),
    );
  }
  set(key: string, value: unknown, options?: { ttlSeconds?: number }): Promise<void> {
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
  deleteMany(pattern: string, options?: { limit?: number }): Promise<number> {
    return storageDeleteMany(
      this.endpoint,
      this.functionId,
      this.tenantScope,
      safeStoragePattern(pattern),
      safeStorageLimit(options?.limit),
    );
  }
  forTenant(tenantId: string): ScopedStorage {
    return new DatabaseStorage(this.endpoint, this.functionId, safeTenant(tenantId));
  }
}
export class RedisCache implements ScopedCache {
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
    return new RedisCache(this.redis, this.scope, safeTenant(tenantId), this.policy);
  }
  private key(key: string): string {
    return `mcpops:${this.scope}:${this.tenantScope}:${safeKey(key)}`;
  }
  private ttl(requested?: number): number {
    return Math.max(
      1,
      Math.min(requested ?? this.policy.defaultTtlSeconds, this.policy.maxTtlSeconds),
    );
  }
}
export class InvocationAudit implements AuditWriter {
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
      ...(this.request.caller.subject ? { actorId: this.request.caller.subject } : {}),
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
  const defaultTtlSeconds = policy?.defaultTtlSeconds ?? policy?.ttlSeconds ?? 300;
  const maxTtlSeconds = policy?.maxTtlSeconds ?? 86_400;
  return {
    defaultTtlSeconds: Math.min(defaultTtlSeconds, maxTtlSeconds),
    maxTtlSeconds,
  };
}
export function linkAbortSignal(
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
function safeStoragePattern(value: string): string {
  if (
    !value ||
    value.length > 512 ||
    /[\u0000-\u001f]/.test(value) ||
    (value.match(/\*/g)?.length ?? 0) > 1
  )
    throw new Error("Invalid storage pattern");
  return value;
}
function safeStorageLimit(value = 100): number {
  if (!Number.isInteger(value) || value < 1 || value > 1_000)
    throw new Error("Storage limit must be an integer between 1 and 1000");
  return value;
}
function safeTenant(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value)) throw new Error("Invalid tenant scope");
  return value;
}
