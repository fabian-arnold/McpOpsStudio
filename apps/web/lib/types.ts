export type RuntimeEndpointStatus =
  "draft" | "deployed" | "disabled" | "failed";
export type FunctionRisk = "read" | "write" | "destructive";

export type EndpointUrls = {
  runtimeBaseUrl: string;
  mcpUrl: string;
  httpBaseUrl: string;
};

export type Dashboard = {
  stats: {
    endpoints: number;
    calls24h: number;
    errorRate: number;
    averageLatencyMs: number;
    activeDeployments: number;
    failedCalls24h?: number;
    p95LatencyMs?: number;
  };
  recentExecutions: Execution[];
  auditEvents: AuditEvent[];
  /** Time buckets are produced by the API. The UI never synthesizes them. */
  trafficBuckets?: { startedAt: string; calls: number; failures: number }[];
  context?: {
    generatedAt: string;
    window: string;
    previousWindow: string;
    bucketMinutes: number;
  };
  comparisons?: Record<
    string,
    { current: number; previous: number; changePercent: number | null }
  >;
  health?: {
    status: string;
    database?: string;
    deployedEndpoints?: number;
    endpointsWithActiveSnapshot?: number;
    endpointsWithoutActiveSnapshot?: number;
    failedDeployments24h?: number;
  };
  activeDeployments?: {
    id: string;
    version: number;
    checksum: string;
    completedAt?: string | null;
    endpoint: { id: string; name: string; slug: string; kind: "mcp" | "http" };
    endpoints?: EndpointUrls;
    environmentEndpoints?: Record<string, EndpointUrls>;
  }[];
};

export type GlobalOverview = {
  generatedAt: string;
  window: "24h";
  stats: {
    projects: number;
    activeProjects: number;
    endpoints: number;
    functions: number;
    calls24h: number;
    failedCalls24h: number;
    errorRate: number;
    degradedProjects: number;
  };
  projects: Array<{
    id: string;
    name: string;
    slug: string;
    description: string;
    status: "active" | "archived";
    updatedAt: string;
    health: "healthy" | "degraded" | "archived";
    endpoints: {
      total: number;
      mcp: number;
      http: number;
      deployed: number;
      failed: number;
      activeSnapshots: number;
    };
    functions: number;
    execution: {
      calls24h: number;
      failedCalls24h: number;
      errorRate: number;
      averageLatencyMs: number;
    };
    environments: Array<{
      id: string;
      name: string;
      slug: string;
      activeDeployment: {
        id: string;
        version: number;
        status: string;
        completedAt: string | null;
      } | null;
    }>;
    latestDeployment: {
      id: string;
      version: number;
      status: string;
      createdAt: string;
      completedAt: string | null;
      environment: { name: string; slug: string };
    } | null;
  }>;
};

export type RuntimeEndpoint = {
  id: string;
  kind: "mcp" | "http";
  name: string;
  slug: string;
  description: string;
  status: RuntimeEndpointStatus;
  environment: { id: string; name: string; slug: string };
  activeDeployment:
    | { id: string; version: number; createdAt: string; checksum: string }
    | undefined;
  functionCount: number;
  mcpToolCount: number;
  httpRouteCount: number;
  authMode: string;
  endpoints?: EndpointUrls;
  environmentEndpoints?: Record<string, EndpointUrls>;
  createdAt: string;
  updatedAt: string;
  runtimeVersion?: string;
  runtimeConfig?: { maxConcurrentRequests?: number };
  defaultAuthPolicyId?: string | null;
};

export type OpsFunction = {
  id: string;
  name: string;
  slug: string;
  description: string;
  code: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  timeoutMs: number;
  enabled: boolean;
  riskLevel: FunctionRisk;
  requiredPermissions: string[];
  secretGrants: { secretId?: string; name: string }[];
  cachePolicy?: { enabled: boolean; ttlSeconds: number };
  version: number;
  usages?: {
    endpointId: string;
    endpointName: string;
    endpointKind: "mcp" | "http";
    mcpTools?: string[];
    httpRoutes?: string[];
    deployedVersion?: number | null;
    stale?: boolean;
  }[];
};

export type McpBinding = {
  id: string;
  functionId: string;
  toolName: string;
  title: string;
  description: string;
  enabled: boolean;
};
export type HttpBinding = {
  id: string;
  functionId: string;
  method: string;
  path: string;
  inputMapping?: Record<string, unknown> | null;
  responseMapping?: Record<string, unknown> | null;
  enabled: boolean;
};
export type FunctionBindingEndpoint = {
  id: string;
  name: string;
  slug: string;
  kind: "mcp" | "http";
};
export type FunctionMcpBinding = McpBinding & {
  endpoint: FunctionBindingEndpoint;
};
export type FunctionHttpBinding = HttpBinding & {
  endpoint: FunctionBindingEndpoint;
};
export type FunctionDetail = OpsFunction & {
  mcpBindings: FunctionMcpBinding[];
  httpBindings: FunctionHttpBinding[];
};
export type ProjectLibrary = {
  id: string;
  name: string;
  importPath: string;
  version: number;
  description: string;
  code?: string;
  exportedFunctions?: string[];
  importExample?: string;
  versionCount?: number;
};
export type Deployment = {
  id: string;
  version: number;
  status: string;
  checksum: string;
  createdAt: string;
  completedAt?: string;
  functionVersions: number;
  logs?: { level: string; message: string }[];
};
export type Execution = {
  id: string;
  endpointId?: string;
  functionId?: string;
  createdAt: string;
  requestId: string;
  correlationId?: string;
  parentExecutionId?: string;
  rootExecutionId?: string;
  invocationSource: string;
  functionName: string;
  binding?: string;
  status: string;
  durationMs: number;
  functionVersion: number;
  deploymentVersion: number;
  caller?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
};
export type RuntimeLog = {
  id: string;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  metadata?: Record<string, unknown>;
  sizeBytes: number;
  requestId: string;
  correlationId?: string;
  executionId: string;
  deploymentId: string;
  environment: { id: string; name: string; slug: string };
  endpoint: { id: string; name: string; slug: string; kind: "mcp" | "http" };
  function: { id: string; name: string; slug: string };
};
export type AuditEvent = {
  id: string;
  createdAt: string;
  action: string;
  actor: string;
  actorType?: "user" | "caller" | "system";
  actorId?: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

export type RuntimeEndpointDetail = RuntimeEndpoint & {
  functions: OpsFunction[];
  mcpBindings: McpBinding[];
  httpBindings: HttpBinding[];
  deployments: Deployment[];
  executions: Execution[];
  authPolicies: {
    id: string;
    name: string;
    type: string;
    status?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
    providerStatus?: string;
  }[];
  assignedAuthPolicies: {
    id: string;
    name: string;
    type: string;
    status?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
    providerStatus?: string;
    position: number;
  }[];
  secrets: {
    id: string;
    name: string;
    environment: string;
    grants: number;
    updatedAt: string;
    usage?: { functionId: string; functionName: string }[];
  }[];
  libraries: ProjectLibrary[];
  networkPolicy: {
    allowedHosts: string[];
    allowedMethods: string[];
    allowedPorts?: number[];
    allowPrivateHosts?: string[];
    maxResponseBytes?: number;
  };
  telemetry?: {
    calls?: number;
    failures?: number;
    errorRate?: number;
    averageLatencyMs?: number;
    p95LatencyMs?: number;
  };
  runtimeHealth?: {
    status: string;
    checkedAt?: string;
    reachable?: boolean;
    activeDeploymentLoadable?: boolean;
  };
  securityPosture?: {
    endpointAuthentication?: "enforced" | "not_configured";
    defaultPolicy?: { id: string; name: string; type: string } | null;
    snapshottedPolicyCount?: number;
    source?: string;
    network?: {
      configured: boolean;
      allowedHostCount: number;
      allowedMethods: unknown[];
      maxResponseBytes: number | null;
    };
    trustedDeveloperExecution?: boolean;
  };
  storageMetrics?: {
    storage?: {
      namespaces: number;
      storedKeys: number;
      activeKeys: number;
      expiredKeys: number;
      valuesExposed: false;
    };
    cache?: {
      status: string;
      activeKeys: number | null;
      approximate: boolean;
      hitRate: null;
      hitRateAvailable: false;
      keyMaterialExposed: false;
    };
  };
};

export type SessionIdentity = {
  user: {
    id: string;
    email: string;
    name?: string;
    role: string;
    mustChangePassword?: boolean;
    project: {
      id: string;
      name: string;
      slug: string;
      status?: "active" | "archived";
    };
  };
};

export type ProjectSummary = {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  _count?: { endpoints: number; environments: number };
};

export type UserSummary = {
  id: string;
  email: string;
  role: "owner" | "admin" | "developer" | "operator" | "viewer";
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EnvironmentSummary = {
  id: string;
  name: string;
  slug: string;
  baseUrl?: string;
};

export type DeploymentSummary = {
  activeSnapshots: number;
  sevenDayDeployments: number;
  successfulDeployments: number;
  failedDeployments: number;
  inProgressDeployments: number;
  averageBuildDurationMs: number | null;
};
