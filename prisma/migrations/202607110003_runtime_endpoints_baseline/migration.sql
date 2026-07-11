-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'admin', 'developer', 'operator', 'viewer');

-- CreateEnum
CREATE TYPE "RuntimeEndpointStatus" AS ENUM ('draft', 'deployed', 'disabled', 'failed');

-- CreateEnum
CREATE TYPE "RuntimeEndpointKind" AS ENUM ('mcp', 'http');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('read', 'write', 'destructive');

-- CreateEnum
CREATE TYPE "HttpMethod" AS ENUM ('GET', 'POST', 'PUT', 'PATCH', 'DELETE');

-- CreateEnum
CREATE TYPE "SecretAccessMode" AS ENUM ('read');

-- CreateEnum
CREATE TYPE "AuthPolicyType" AS ENUM ('public', 'api_key', 'bearer_token', 'basic_auth', 'jwt', 'oidc', 'entra_id', 'webhook_signature');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('queued', 'building', 'deploying', 'active', 'failed', 'rolled_back');

-- CreateEnum
CREATE TYPE "InvocationSource" AS ENUM ('mcp', 'http', 'test', 'internal');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('success', 'error', 'denied', 'timeout', 'validation_error');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'caller', 'system');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "ProjectStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'viewer',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environments" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "activeProjectDeploymentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_endpoints" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" "RuntimeEndpointKind" NOT NULL,
    "status" "RuntimeEndpointStatus" NOT NULL DEFAULT 'draft',
    "runtimeVersion" TEXT NOT NULL DEFAULT '1',
    "runtimeConfig" JSONB NOT NULL DEFAULT '{}',
    "activeDeploymentId" UUID,
    "defaultAuthPolicyId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runtime_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "functions" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'read',
    "requiredPermissions" JSONB NOT NULL,
    "cachePolicy" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "functions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "function_versions" (
    "id" UUID NOT NULL,
    "functionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "compiledCode" TEXT,
    "sourceMap" TEXT,
    "checksum" TEXT NOT NULL,
    "validationResult" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" UUID,

    CONSTRAINT "function_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_tool_bindings" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "functionId" UUID NOT NULL,
    "toolName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_tool_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "http_route_bindings" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "functionId" UUID NOT NULL,
    "method" "HttpMethod" NOT NULL,
    "path" TEXT NOT NULL,
    "inputMapping" JSONB,
    "responseMapping" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "http_route_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_libraries" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "importPath" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL,
    "exportedFunctions" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_libraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secrets" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secret_grants" (
    "id" UUID NOT NULL,
    "functionId" UUID NOT NULL,
    "secretName" TEXT NOT NULL,
    "secretId" UUID,
    "accessMode" "SecretAccessMode" NOT NULL DEFAULT 'read',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secret_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_connections" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "secretId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "database_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviewed_query_definitions" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "queryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviewed_query_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviewed_query_versions" (
    "id" UUID NOT NULL,
    "queryDefinitionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "sql" TEXT NOT NULL,
    "parameterOrder" JSONB NOT NULL,
    "parameterSchema" JSONB NOT NULL,
    "resultSchema" JSONB,
    "timeoutMs" INTEGER NOT NULL DEFAULT 5000,
    "maxRows" INTEGER NOT NULL DEFAULT 100,
    "maxBytes" INTEGER NOT NULL DEFAULT 1048576,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" UUID,

    CONSTRAINT "reviewed_query_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "function_query_grants" (
    "id" UUID NOT NULL,
    "functionId" UUID NOT NULL,
    "queryDefinitionId" UUID NOT NULL,
    "queryVersionId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "function_query_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_policies" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AuthPolicyType" NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_policies" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "allowedHosts" JSONB NOT NULL,
    "allowedMethods" JSONB NOT NULL,
    "allowedPorts" JSONB NOT NULL,
    "allowPrivateHosts" JSONB NOT NULL DEFAULT '[]',
    "maxResponseBytes" INTEGER NOT NULL DEFAULT 1048576,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "network_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_namespaces" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_namespaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_entries" (
    "id" UUID NOT NULL,
    "namespaceId" UUID NOT NULL,
    "functionId" UUID NOT NULL,
    "tenantScope" TEXT NOT NULL DEFAULT '__global__',
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "projectDeploymentId" UUID,
    "version" INTEGER NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'queued',
    "snapshot" JSONB NOT NULL,
    "runtimeConfig" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_deployments" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "sourceProjectDeploymentId" UUID,
    "version" INTEGER NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'queued',
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "checksum" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "project_deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_logs" (
    "id" UUID NOT NULL,
    "deploymentId" UUID NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "function_executions" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "functionId" UUID NOT NULL,
    "functionVersionId" UUID NOT NULL,
    "mcpToolBindingId" UUID,
    "httpRouteBindingId" UUID,
    "deploymentId" UUID NOT NULL,
    "requestId" TEXT NOT NULL,
    "correlationId" TEXT,
    "invocationSource" "InvocationSource" NOT NULL,
    "callerIdentity" JSONB NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" JSONB,
    "durationMs" INTEGER NOT NULL,
    "status" "ExecutionStatus" NOT NULL,
    "parentExecutionId" UUID,
    "rootExecutionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "function_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "projectId" UUID,
    "environmentId" UUID,
    "endpointId" UUID,
    "functionId" UUID,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_expiresAt_idx" ON "sessions"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "environments_activeProjectDeploymentId_key" ON "environments"("activeProjectDeploymentId");

-- CreateIndex
CREATE UNIQUE INDEX "environments_projectId_slug_key" ON "environments"("projectId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_endpoints_activeDeploymentId_key" ON "runtime_endpoints"("activeDeploymentId");

-- CreateIndex
CREATE INDEX "runtime_endpoints_projectId_kind_status_idx" ON "runtime_endpoints"("projectId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_endpoints_projectId_kind_slug_key" ON "runtime_endpoints"("projectId", "kind", "slug");

-- CreateIndex
CREATE INDEX "functions_projectId_idx" ON "functions"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "functions_projectId_slug_key" ON "functions"("projectId", "slug");

-- CreateIndex
CREATE INDEX "function_versions_checksum_idx" ON "function_versions"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "function_versions_functionId_version_key" ON "function_versions"("functionId", "version");

-- CreateIndex
CREATE INDEX "mcp_tool_bindings_functionId_idx" ON "mcp_tool_bindings"("functionId");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_tool_bindings_endpointId_toolName_key" ON "mcp_tool_bindings"("endpointId", "toolName");

-- CreateIndex
CREATE INDEX "http_route_bindings_functionId_idx" ON "http_route_bindings"("functionId");

-- CreateIndex
CREATE UNIQUE INDEX "http_route_bindings_endpointId_method_path_key" ON "http_route_bindings"("endpointId", "method", "path");

-- CreateIndex
CREATE INDEX "project_libraries_projectId_name_idx" ON "project_libraries"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "project_libraries_projectId_importPath_version_key" ON "project_libraries"("projectId", "importPath", "version");

-- CreateIndex
CREATE UNIQUE INDEX "secrets_projectId_environmentId_name_key" ON "secrets"("projectId", "environmentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "secret_grants_functionId_secretName_key" ON "secret_grants"("functionId", "secretName");

-- CreateIndex
CREATE INDEX "database_connections_projectId_environmentId_enabled_idx" ON "database_connections"("projectId", "environmentId", "enabled");

-- CreateIndex
CREATE INDEX "database_connections_secretId_idx" ON "database_connections"("secretId");

-- CreateIndex
CREATE UNIQUE INDEX "database_connections_projectId_environmentId_name_key" ON "database_connections"("projectId", "environmentId", "name");

-- CreateIndex
CREATE INDEX "reviewed_query_definitions_projectId_environmentId_idx" ON "reviewed_query_definitions"("projectId", "environmentId");

-- CreateIndex
CREATE UNIQUE INDEX "reviewed_query_definitions_connectionId_queryId_key" ON "reviewed_query_definitions"("connectionId", "queryId");

-- CreateIndex
CREATE INDEX "reviewed_query_versions_queryDefinitionId_enabled_idx" ON "reviewed_query_versions"("queryDefinitionId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "reviewed_query_versions_queryDefinitionId_version_key" ON "reviewed_query_versions"("queryDefinitionId", "version");

-- CreateIndex
CREATE INDEX "function_query_grants_functionId_enabled_idx" ON "function_query_grants"("functionId", "enabled");

-- CreateIndex
CREATE INDEX "function_query_grants_queryVersionId_idx" ON "function_query_grants"("queryVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "function_query_grants_functionId_queryDefinitionId_key" ON "function_query_grants"("functionId", "queryDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_policies_projectId_name_key" ON "auth_policies"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "network_policies_endpointId_key" ON "network_policies"("endpointId");

-- CreateIndex
CREATE INDEX "network_policies_projectId_idx" ON "network_policies"("projectId");

-- CreateIndex
CREATE INDEX "storage_namespaces_projectId_idx" ON "storage_namespaces"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "storage_namespaces_projectId_environmentId_name_key" ON "storage_namespaces"("projectId", "environmentId", "name");

-- CreateIndex
CREATE INDEX "storage_entries_expiresAt_idx" ON "storage_entries"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "storage_entries_namespaceId_functionId_tenantScope_key_key" ON "storage_entries"("namespaceId", "functionId", "tenantScope", "key");

-- CreateIndex
CREATE INDEX "deployments_endpointId_status_idx" ON "deployments"("endpointId", "status");

-- CreateIndex
CREATE INDEX "deployments_projectDeploymentId_status_idx" ON "deployments"("projectDeploymentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "deployments_endpointId_version_key" ON "deployments"("endpointId", "version");

-- CreateIndex
CREATE INDEX "project_deployments_projectId_createdAt_idx" ON "project_deployments"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "project_deployments_sourceProjectDeploymentId_idx" ON "project_deployments"("sourceProjectDeploymentId");

-- CreateIndex
CREATE UNIQUE INDEX "project_deployments_projectId_environmentId_version_key" ON "project_deployments"("projectId", "environmentId", "version");

-- CreateIndex
CREATE INDEX "deployment_logs_deploymentId_createdAt_idx" ON "deployment_logs"("deploymentId", "createdAt");

-- CreateIndex
CREATE INDEX "function_executions_projectId_createdAt_idx" ON "function_executions"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "function_executions_endpointId_functionId_status_createdAt_idx" ON "function_executions"("endpointId", "functionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "function_executions_functionVersionId_idx" ON "function_executions"("functionVersionId");

-- CreateIndex
CREATE INDEX "function_executions_correlationId_idx" ON "function_executions"("correlationId");

-- CreateIndex
CREATE INDEX "function_executions_parentExecutionId_idx" ON "function_executions"("parentExecutionId");

-- CreateIndex
CREATE INDEX "function_executions_rootExecutionId_idx" ON "function_executions"("rootExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "function_executions_projectId_requestId_key" ON "function_executions"("projectId", "requestId");

-- CreateIndex
CREATE INDEX "audit_events_projectId_createdAt_idx" ON "audit_events"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_endpointId_action_createdAt_idx" ON "audit_events"("endpointId", "action", "createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "environments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "environments_activeProjectDeploymentId_fkey" FOREIGN KEY ("activeProjectDeploymentId") REFERENCES "project_deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_endpoints" ADD CONSTRAINT "runtime_endpoints_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_endpoints" ADD CONSTRAINT "runtime_endpoints_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_endpoints" ADD CONSTRAINT "runtime_endpoints_activeDeploymentId_fkey" FOREIGN KEY ("activeDeploymentId") REFERENCES "deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_endpoints" ADD CONSTRAINT "runtime_endpoints_defaultAuthPolicyId_fkey" FOREIGN KEY ("defaultAuthPolicyId") REFERENCES "auth_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "functions" ADD CONSTRAINT "functions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "function_versions" ADD CONSTRAINT "function_versions_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "functions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "function_versions" ADD CONSTRAINT "function_versions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_tool_bindings" ADD CONSTRAINT "mcp_tool_bindings_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "runtime_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_tool_bindings" ADD CONSTRAINT "mcp_tool_bindings_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "functions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "http_route_bindings" ADD CONSTRAINT "http_route_bindings_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "runtime_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "http_route_bindings" ADD CONSTRAINT "http_route_bindings_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "functions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_libraries" ADD CONSTRAINT "project_libraries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secret_grants" ADD CONSTRAINT "secret_grants_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "functions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secret_grants" ADD CONSTRAINT "secret_grants_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_connections" ADD CONSTRAINT "database_connections_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_connections" ADD CONSTRAINT "database_connections_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_connections" ADD CONSTRAINT "database_connections_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewed_query_definitions" ADD CONSTRAINT "reviewed_query_definitions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewed_query_definitions" ADD CONSTRAINT "reviewed_query_definitions_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewed_query_definitions" ADD CONSTRAINT "reviewed_query_definitions_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "database_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewed_query_versions" ADD CONSTRAINT "reviewed_query_versions_queryDefinitionId_fkey" FOREIGN KEY ("queryDefinitionId") REFERENCES "reviewed_query_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviewed_query_versions" ADD CONSTRAINT "reviewed_query_versions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "function_query_grants" ADD CONSTRAINT "function_query_grants_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "functions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "function_query_grants" ADD CONSTRAINT "function_query_grants_queryDefinitionId_fkey" FOREIGN KEY ("queryDefinitionId") REFERENCES "reviewed_query_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "function_query_grants" ADD CONSTRAINT "function_query_grants_queryVersionId_fkey" FOREIGN KEY ("queryVersionId") REFERENCES "reviewed_query_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_policies" ADD CONSTRAINT "auth_policies_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_policies" ADD CONSTRAINT "network_policies_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_policies" ADD CONSTRAINT "network_policies_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "runtime_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_namespaces" ADD CONSTRAINT "storage_namespaces_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_namespaces" ADD CONSTRAINT "storage_namespaces_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_entries" ADD CONSTRAINT "storage_entries_namespaceId_fkey" FOREIGN KEY ("namespaceId") REFERENCES "storage_namespaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_entries" ADD CONSTRAINT "storage_entries_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "functions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "runtime_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_projectDeploymentId_fkey" FOREIGN KEY ("projectDeploymentId") REFERENCES "project_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_deployments" ADD CONSTRAINT "project_deployments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_deployments" ADD CONSTRAINT "project_deployments_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_deployments" ADD CONSTRAINT "project_deployments_sourceProjectDeploymentId_fkey" FOREIGN KEY ("sourceProjectDeploymentId") REFERENCES "project_deployments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "function_executions" ADD CONSTRAINT "function_executions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "function_executions" ADD CONSTRAINT "function_executions_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "runtime_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "function_executions" ADD CONSTRAINT "function_executions_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "functions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "function_executions" ADD CONSTRAINT "function_executions_functionVersionId_fkey" FOREIGN KEY ("functionVersionId") REFERENCES "function_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "function_executions" ADD CONSTRAINT "function_executions_mcpToolBindingId_fkey" FOREIGN KEY ("mcpToolBindingId") REFERENCES "mcp_tool_bindings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "function_executions" ADD CONSTRAINT "function_executions_httpRouteBindingId_fkey" FOREIGN KEY ("httpRouteBindingId") REFERENCES "http_route_bindings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "function_executions" ADD CONSTRAINT "function_executions_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "deployments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "runtime_endpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "functions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
