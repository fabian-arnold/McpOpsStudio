ALTER TABLE "project_deployments"
ADD COLUMN "failureCause" TEXT,
ADD COLUMN "failureMetadata" JSONB;
