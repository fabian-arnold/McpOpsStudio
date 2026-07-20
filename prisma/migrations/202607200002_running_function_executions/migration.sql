ALTER TYPE "ExecutionStatus" ADD VALUE 'running' BEFORE 'success';

ALTER TABLE "function_executions"
ADD COLUMN "heartbeatAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3);

UPDATE "function_executions"
SET "completedAt" = "createdAt" + ("durationMs" * INTERVAL '1 millisecond');

CREATE INDEX "function_executions_status_heartbeatAt_idx"
ON "function_executions"("status", "heartbeatAt");
