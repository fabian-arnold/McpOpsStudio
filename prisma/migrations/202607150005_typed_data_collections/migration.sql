CREATE TABLE "data_collections" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "data_collections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_collection_versions" (
    "id" UUID NOT NULL,
    "collectionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "schema" JSONB NOT NULL,
    "indexes" JSONB NOT NULL DEFAULT '[]',
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "data_collection_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "function_collection_grants" (
    "id" UUID NOT NULL,
    "functionId" UUID NOT NULL,
    "collectionId" UUID NOT NULL,
    "permissions" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "function_collection_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collection_records" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "collectionId" UUID NOT NULL,
    "schemaVersionId" UUID NOT NULL,
    "tenantScope" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collection_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "data_collections_projectId_slug_key" ON "data_collections"("projectId", "slug");
CREATE INDEX "data_collections_projectId_enabled_idx" ON "data_collections"("projectId", "enabled");
CREATE UNIQUE INDEX "data_collection_versions_collectionId_version_key" ON "data_collection_versions"("collectionId", "version");
CREATE INDEX "data_collection_versions_collectionId_createdAt_idx" ON "data_collection_versions"("collectionId", "createdAt");
CREATE UNIQUE INDEX "function_collection_grants_functionId_collectionId_key" ON "function_collection_grants"("functionId", "collectionId");
CREATE INDEX "function_collection_grants_collectionId_enabled_idx" ON "function_collection_grants"("collectionId", "enabled");
CREATE INDEX "collection_records_collectionId_environmentId_tenantScope_createdAt_id_idx" ON "collection_records"("collectionId", "environmentId", "tenantScope", "createdAt", "id");
CREATE INDEX "collection_records_projectId_environmentId_idx" ON "collection_records"("projectId", "environmentId");
CREATE INDEX "collection_records_data_idx" ON "collection_records" USING GIN ("data");

ALTER TABLE "data_collections" ADD CONSTRAINT "data_collections_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_collection_versions" ADD CONSTRAINT "data_collection_versions_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "data_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "function_collection_grants" ADD CONSTRAINT "function_collection_grants_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "functions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "function_collection_grants" ADD CONSTRAINT "function_collection_grants_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "data_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "data_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_schemaVersionId_fkey" FOREIGN KEY ("schemaVersionId") REFERENCES "data_collection_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
