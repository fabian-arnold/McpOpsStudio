ALTER TYPE "InvocationSource" ADD VALUE IF NOT EXISTS 'cron';

CREATE TYPE "ScheduledRunStatus" AS ENUM ('scheduled', 'running', 'skipped', 'missed', 'success', 'failed');
CREATE TYPE "ScheduledRunOrigin" AS ENUM ('scheduled', 'manual');

CREATE TABLE "cron_bindings" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "environmentId" UUID NOT NULL,
  "functionId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "expression" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "serviceSubject" TEXT NOT NULL,
  "permissionGrants" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "cron_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "schedule_deployments" (
  "id" UUID NOT NULL,
  "projectDeploymentId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "environmentId" UUID NOT NULL,
  "status" "DeploymentStatus" NOT NULL DEFAULT 'queued',
  "snapshot" JSONB NOT NULL DEFAULT '{}',
  "checksum" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "schedule_deployments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scheduled_runs" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "environmentId" UUID NOT NULL,
  "cronBindingId" UUID NOT NULL,
  "scheduleDeploymentId" UUID NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "triggeredAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "origin" "ScheduledRunOrigin" NOT NULL DEFAULT 'scheduled',
  "status" "ScheduledRunStatus" NOT NULL DEFAULT 'scheduled',
  "requestId" TEXT NOT NULL,
  "executionId" UUID,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduled_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "network_policies" ALTER COLUMN "endpointId" DROP NOT NULL;
ALTER TABLE "network_policies" ADD COLUMN "cronBindingId" UUID;

ALTER TABLE "function_executions" ALTER COLUMN "endpointId" DROP NOT NULL;
ALTER TABLE "function_executions" ALTER COLUMN "deploymentId" DROP NOT NULL;
ALTER TABLE "function_executions" ADD COLUMN "cronBindingId" UUID;
ALTER TABLE "function_executions" ADD COLUMN "scheduleDeploymentId" UUID;

ALTER TABLE "runtime_logs" ALTER COLUMN "endpointId" DROP NOT NULL;
ALTER TABLE "runtime_logs" ALTER COLUMN "deploymentId" DROP NOT NULL;
ALTER TABLE "runtime_logs" ADD COLUMN "cronBindingId" UUID;
ALTER TABLE "runtime_logs" ADD COLUMN "scheduleDeploymentId" UUID;

ALTER TABLE "audit_events" ADD COLUMN "cronBindingId" UUID;

CREATE UNIQUE INDEX "cron_bindings_environmentId_name_key" ON "cron_bindings"("environmentId", "name");
CREATE INDEX "cron_bindings_projectId_environmentId_enabled_idx" ON "cron_bindings"("projectId", "environmentId", "enabled");
CREATE INDEX "cron_bindings_functionId_idx" ON "cron_bindings"("functionId");
CREATE UNIQUE INDEX "network_policies_cronBindingId_key" ON "network_policies"("cronBindingId");
CREATE UNIQUE INDEX "schedule_deployments_projectDeploymentId_key" ON "schedule_deployments"("projectDeploymentId");
CREATE INDEX "schedule_deployments_projectId_environmentId_status_idx" ON "schedule_deployments"("projectId", "environmentId", "status");
CREATE UNIQUE INDEX "scheduled_runs_requestId_key" ON "scheduled_runs"("requestId");
CREATE UNIQUE INDEX "scheduled_runs_executionId_key" ON "scheduled_runs"("executionId");
CREATE UNIQUE INDEX "scheduled_runs_scheduleDeploymentId_cronBindingId_scheduledAt_key" ON "scheduled_runs"("scheduleDeploymentId", "cronBindingId", "scheduledAt");
CREATE INDEX "scheduled_runs_cronBindingId_createdAt_idx" ON "scheduled_runs"("cronBindingId", "createdAt");
CREATE INDEX "scheduled_runs_projectId_environmentId_status_createdAt_idx" ON "scheduled_runs"("projectId", "environmentId", "status", "createdAt");
CREATE INDEX "function_executions_cronBindingId_functionId_status_createdAt_idx" ON "function_executions"("cronBindingId", "functionId", "status", "createdAt");
CREATE INDEX "function_executions_scheduleDeploymentId_idx" ON "function_executions"("scheduleDeploymentId");
CREATE INDEX "audit_events_cronBindingId_action_createdAt_idx" ON "audit_events"("cronBindingId", "action", "createdAt");

ALTER TABLE "cron_bindings" ADD CONSTRAINT "cron_bindings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cron_bindings" ADD CONSTRAINT "cron_bindings_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cron_bindings" ADD CONSTRAINT "cron_bindings_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "functions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "network_policies" ADD CONSTRAINT "network_policies_cronBindingId_fkey" FOREIGN KEY ("cronBindingId") REFERENCES "cron_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_deployments" ADD CONSTRAINT "schedule_deployments_projectDeploymentId_fkey" FOREIGN KEY ("projectDeploymentId") REFERENCES "project_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_deployments" ADD CONSTRAINT "schedule_deployments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_deployments" ADD CONSTRAINT "schedule_deployments_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_cronBindingId_fkey" FOREIGN KEY ("cronBindingId") REFERENCES "cron_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_scheduleDeploymentId_fkey" FOREIGN KEY ("scheduleDeploymentId") REFERENCES "schedule_deployments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "function_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "function_executions" ADD CONSTRAINT "function_executions_cronBindingId_fkey" FOREIGN KEY ("cronBindingId") REFERENCES "cron_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "function_executions" ADD CONSTRAINT "function_executions_scheduleDeploymentId_fkey" FOREIGN KEY ("scheduleDeploymentId") REFERENCES "schedule_deployments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runtime_logs" ADD CONSTRAINT "runtime_logs_cronBindingId_fkey" FOREIGN KEY ("cronBindingId") REFERENCES "cron_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "runtime_logs" ADD CONSTRAINT "runtime_logs_scheduleDeploymentId_fkey" FOREIGN KEY ("scheduleDeploymentId") REFERENCES "schedule_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_cronBindingId_fkey" FOREIGN KEY ("cronBindingId") REFERENCES "cron_bindings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "network_policies" ADD CONSTRAINT "network_policies_owner_check" CHECK (("endpointId" IS NOT NULL)::int + ("cronBindingId" IS NOT NULL)::int = 1);
ALTER TABLE "function_executions" ADD CONSTRAINT "function_executions_lineage_check" CHECK (
  (("endpointId" IS NOT NULL) AND ("deploymentId" IS NOT NULL) AND ("cronBindingId" IS NULL) AND ("scheduleDeploymentId" IS NULL)) OR
  (("endpointId" IS NULL) AND ("deploymentId" IS NULL) AND ("cronBindingId" IS NOT NULL) AND ("scheduleDeploymentId" IS NOT NULL))
);
ALTER TABLE "function_executions" ADD CONSTRAINT "function_executions_source_lineage_check" CHECK (
  ("invocationSource" = 'cron' AND "cronBindingId" IS NOT NULL) OR
  ("invocationSource" IN ('mcp', 'http', 'test') AND "endpointId" IS NOT NULL) OR
  ("invocationSource" = 'internal')
);
ALTER TABLE "runtime_logs" ADD CONSTRAINT "runtime_logs_lineage_check" CHECK (
  (("endpointId" IS NOT NULL) AND ("deploymentId" IS NOT NULL) AND ("cronBindingId" IS NULL) AND ("scheduleDeploymentId" IS NULL)) OR
  (("endpointId" IS NULL) AND ("deploymentId" IS NULL) AND ("cronBindingId" IS NOT NULL) AND ("scheduleDeploymentId" IS NOT NULL))
);
