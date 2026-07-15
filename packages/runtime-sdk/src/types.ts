export type InvocationSource = "mcp" | "http" | "cron" | "test" | "internal";
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
  tls?: { rejectUnauthorized: boolean };
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
export type CollectionRecord<T = Record<string, unknown>> = {
  id: string;
  data: T;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type CollectionWhere =
  | { field: string; op: string; value?: unknown }
  | { and: CollectionWhere[] }
  | { or: CollectionWhere[] }
  | { not: CollectionWhere };
export type CollectionQuery = {
  where?: CollectionWhere;
  orderBy?: Array<{ field: string; direction?: "asc" | "desc" }>;
  select?: string[];
  limit?: number;
  cursor?: string;
};
export interface ScopedCollection<T = Record<string, unknown>> {
  create(data: T): Promise<CollectionRecord<T>>;
  get(id: string, options?: { select?: string[] }): Promise<CollectionRecord<T> | null>;
  query(query?: CollectionQuery): Promise<{
    items: Array<CollectionRecord<Partial<T>>>;
    nextCursor?: string;
  }>;
  count(options?: { where?: CollectionWhere }): Promise<number>;
  update(
    id: string,
    data: T,
    options: { revision: number },
  ): Promise<CollectionRecord<T>>;
  delete(id: string, options: { revision: number }): Promise<void>;
}
export interface ProjectCollections {
  collection<T = Record<string, unknown>>(slug: string): ScopedCollection<T>;
}
export type EndpointTrigger = {
  type: "endpoint";
  source: "mcp" | "http" | "test";
  endpoint: { id: string; slug: string; name: string; kind: "mcp" | "http" };
};
export type CronTrigger = {
  type: "cron";
  binding: { id: string; name: string };
  scheduledAt: string;
  triggeredAt: string;
  expression: string;
  timezone: string;
  origin: "scheduled" | "manual";
};
export type RuntimeTrigger = EndpointTrigger | CronTrigger;
export type RuntimeContext = {
  invocation: {
    source: InvocationSource;
    requestId: string;
    correlationId?: string;
    simulatedSource?: "mcp" | "http" | "cron";
  };
  trigger: RuntimeTrigger;
  project: { id: string; slug: string; name: string };
  environment: { id: string; slug: string; name: string };
  endpoint?: {
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
  collections: ProjectCollections;
  functions: ProjectFunctions;
  abortSignal: AbortSignal;
};

export type RuntimeHandler = (ctx: RuntimeContext, input: unknown) => Promise<unknown>;
