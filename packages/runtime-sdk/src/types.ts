export type InvocationSource = "mcp" | "http" | "test" | "internal";
export type RiskLevel = "read" | "write" | "destructive";

export type CallerIdentity = {
  subject?: string;
  email?: string;
  name?: string;
  tenantId?: string;
  permissions: string[];
  claims: Record<string, unknown>;
};

export interface SecretAccessor {
  get(name: string): string;
}
export interface SafeLogger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}
export type HttpRequest = {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  timeoutMs?: number;
};
export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  data: unknown;
};
export interface RestrictedHttpClient {
  request(request: HttpRequest): Promise<HttpResponse>;
}
export interface ScopedStorage {
  get(key: string): Promise<unknown>;
  list(
    pattern: string,
    options?: { limit?: number },
  ): Promise<Array<{ key: string; value: unknown }>>;
  set(key: string, value: unknown, options?: { ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  deleteMany(pattern: string, options?: { limit?: number }): Promise<number>;
  forTenant(tenantId: string): ScopedStorage;
}
export interface ScopedCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, options?: { ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  getOrSet(
    key: string,
    producer: () => Promise<unknown>,
    options?: { ttlSeconds?: number },
  ): Promise<unknown>;
  forTenant(tenantId: string): ScopedCache;
}
export interface AuditWriter {
  write(event: {
    action: string;
    targetType: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
export interface ReviewedDatabase {
  query(request: {
    connection: string;
    queryId: string;
    params: Record<string, unknown>;
  }): Promise<unknown>;
}
export interface ProjectFunctions {
  call(slug: string, input: unknown): Promise<unknown>;
}
export type RuntimeContext = {
  invocation: {
    source: InvocationSource;
    requestId: string;
    correlationId?: string;
    simulatedSource?: "mcp" | "http";
  };
  project: { id: string; slug: string; name: string };
  environment: { id: string; slug: string; name: string };
  endpoint: {
    id: string;
    slug: string;
    name: string;
    kind: "mcp" | "http";
  };
  function: { id: string; name: string; riskLevel: RiskLevel };
  caller: CallerIdentity;
  tenant?: { id: string };
  permissions: string[];
  env: Record<string, string>;
  secrets: SecretAccessor;
  logger: SafeLogger;
  http: RestrictedHttpClient;
  storage: ScopedStorage;
  cache: ScopedCache;
  audit: AuditWriter;
  db: ReviewedDatabase;
  functions: ProjectFunctions;
  abortSignal: AbortSignal;
};

export type RuntimeHandler = (ctx: RuntimeContext, input: unknown) => Promise<unknown>;
