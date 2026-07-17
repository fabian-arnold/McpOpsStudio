ALTER TABLE "users"
ADD COLUMN "lastPlatformMcpProjectId" UUID;

ALTER TABLE "users"
ADD CONSTRAINT "users_lastPlatformMcpProjectId_fkey"
FOREIGN KEY ("lastPlatformMcpProjectId") REFERENCES "projects"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_lastPlatformMcpProjectId_idx"
ON "users"("lastPlatformMcpProjectId");
