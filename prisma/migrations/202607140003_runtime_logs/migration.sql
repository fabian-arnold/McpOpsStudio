ALTER TABLE "environments"
ADD COLUMN "logLevel" TEXT NOT NULL DEFAULT 'info',
ADD COLUMN "logRetentionDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "logRetentionMaxEntries" INTEGER NOT NULL DEFAULT 100000,
ADD COLUMN "logRetentionMaxBytes" INTEGER NOT NULL DEFAULT 104857600;

UPDATE "environments"
SET
  "logLevel" = 'debug',
  "logRetentionDays" = 7,
  "logRetentionMaxEntries" = 50000,
  "logRetentionMaxBytes" = 52428800
WHERE "slug" = 'development';

CREATE TABLE "runtime_logs" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "environmentId" UUID NOT NULL,
  "endpointId" UUID NOT NULL,
  "functionId" UUID NOT NULL,
  "deploymentId" UUID NOT NULL,
  "executionId" UUID NOT NULL,
  "requestId" TEXT NOT NULL,
  "correlationId" TEXT,
  "level" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "runtime_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "runtime_logs_projectId_createdAt_idx" ON "runtime_logs"("projectId", "createdAt");
CREATE INDEX "runtime_logs_environmentId_createdAt_idx" ON "runtime_logs"("environmentId", "createdAt");
CREATE INDEX "runtime_logs_projectId_level_createdAt_idx" ON "runtime_logs"("projectId", "level", "createdAt");
CREATE INDEX "runtime_logs_functionId_createdAt_idx" ON "runtime_logs"("functionId", "createdAt");
CREATE INDEX "runtime_logs_requestId_idx" ON "runtime_logs"("requestId");
CREATE INDEX "runtime_logs_correlationId_idx" ON "runtime_logs"("correlationId");

ALTER TABLE "runtime_logs" ADD CONSTRAINT "runtime_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "runtime_logs" ADD CONSTRAINT "runtime_logs_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "runtime_logs" ADD CONSTRAINT "runtime_logs_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "runtime_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "runtime_logs" ADD CONSTRAINT "runtime_logs_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "functions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "runtime_logs" ADD CONSTRAINT "runtime_logs_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "runtime_logs" ADD CONSTRAINT "runtime_logs_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "function_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
