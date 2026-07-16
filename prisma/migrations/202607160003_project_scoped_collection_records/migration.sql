DROP INDEX IF EXISTS "collection_records_collectionId_environmentId_tenantScope_createdAt_id_idx";

ALTER TABLE "collection_records" DROP COLUMN "tenantScope";

CREATE INDEX "collection_records_collectionId_environmentId_createdAt_id_idx"
ON "collection_records"("collectionId", "environmentId", "createdAt", "id");
