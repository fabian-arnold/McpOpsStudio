export type Capabilities = {
  runtimeCapabilities?: { reviewedDatabaseQueries?: boolean };
};

export type Connection = {
  id: string;
  environment: { id: string; name: string; slug: string };
  secret: { id: string; name: string };
  name: string;
  description: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  queryCount: number;
};

export type QueryVersion = {
  id: string;
  version: number;
  sql?: string;
  parameterOrder: string[];
  parameterSchema: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
  timeoutMs: number;
  maxRows: number;
  maxBytes: number;
  enabled: boolean;
  createdAt: string;
};

export type ReviewedQuery = {
  id: string;
  environmentId: string;
  connection: { id: string; name: string; enabled: boolean };
  queryId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  versions: QueryVersion[];
  grantCount: number;
};

export type QueryGrant = {
  id: string;
  functionId: string;
  queryDefinitionId: string;
  queryVersionId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  query: {
    queryId: string;
    name: string;
    version: number;
    connection: { id: string; name: string; enabled: boolean };
    versionEnabled: boolean;
  };
};
