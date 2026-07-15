export type RiskLevel = "read" | "write" | "destructive";
export type InvocationSource = "mcp" | "http" | "cron" | "test" | "internal";

export type CallerIdentity = {
  subject?: string;
  email?: string;
  name?: string;
  tenantId?: string;
  permissions: string[];
  claims: Record<string, unknown>;
};

export type SafeRuntimeErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UPSTREAM_ERROR"
  | "CONFIGURATION_ERROR"
  | "INTERNAL_ERROR";

export type SafeRuntimeError = {
  code: SafeRuntimeErrorCode;
  message: string;
  requestId: string;
  retryable?: boolean;
};

export type JsonSchema = Record<string, unknown>;

export type SnapshotFunction = {
  id: string;
  functionId: string;
  versionId: string;
  version: number;
  name: string;
  slug: string;
  description: string;
  code: string;
  compiledCode: string;
  checksum: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  timeoutMs: number;
  riskLevel: RiskLevel;
  enabled: boolean;
  requiredPermissions: string[];
  secretGrants: string[];
  secretRefs: Array<{ id?: string; name: string }>;
};

export type SnapshotMcpBinding = {
  id: string;
  functionId: string;
  toolName: string;
  title: string;
  description: string;
  enabled: boolean;
};

export type SnapshotHttpBinding = {
  id: string;
  functionId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  inputMapping?: unknown;
  responseMapping?: unknown;
  enabled: boolean;
};

export type SnapshotReviewedQuery = {
  grantId: string;
  functionId: string;
  queryDefinitionId: string;
  queryVersionId: string;
  queryId: string;
  queryVersion: number;
  connection: { id: string; name: string; secretId: string };
  sql: string;
  parameterOrder: string[];
  parameterSchema: JsonSchema;
  resultSchema?: JsonSchema;
  timeoutMs: number;
  maxRows: number;
  maxBytes: number;
};

export type SnapshotCollectionGrant = {
  grantId: string;
  functionId: string;
  collectionId: string;
  slug: string;
  schemaVersionId: string;
  schemaVersion: number;
  schema: JsonSchema;
  indexes: Array<{
    name: string;
    kind: "btree" | "gin";
    fields: string[];
    unique: boolean;
  }>;
  permissions: Array<"read" | "write" | "delete">;
};

export type DeploymentSnapshot = {
  schemaVersion: 1;
  createdAt: string;
  project: { id: string; slug: string; name: string };
  environment: { id: string; slug: string; name: string };
  endpoint: { id: string; slug: string; name: string; kind: "mcp" | "http" };
  functions: SnapshotFunction[];
  functionCalls: Array<{
    callerFunctionId: string;
    calleeFunctionId: string;
    calleeSlug: string;
  }>;
  mcpBindings: SnapshotMcpBinding[];
  httpBindings: SnapshotHttpBinding[];
  libraries: Array<{
    id: string;
    name: string;
    importPath: string;
    version: number;
    code: string;
  }>;
  authPolicies: Array<{
    id: string;
    name: string;
    type: string;
    config: unknown;
  }>;
  capabilities: { reviewedDatabaseQueries: { enabled: boolean } };
  reviewedQueries: SnapshotReviewedQuery[];
  collections: SnapshotCollectionGrant[];
  defaultAuthPolicyId?: string;
  env: Record<string, string>;
  networkPolicy?: {
    allowedHosts: string[];
    allowedMethods: string[];
    allowedPorts: number[];
    maxResponseBytes: number;
    allowPrivateHosts?: string[];
    allowInsecureTlsHosts?: string[];
  };
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
};
