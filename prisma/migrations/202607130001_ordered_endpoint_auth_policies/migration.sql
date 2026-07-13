-- CreateTable
CREATE TABLE "endpoint_auth_policies" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "authPolicyId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "endpoint_auth_policies_pkey" PRIMARY KEY ("id")
);

-- Preserve every endpoint's existing active policy as the first chain entry.
INSERT INTO "endpoint_auth_policies" (
    "id", "endpointId", "authPolicyId", "position", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), "id", "defaultAuthPolicyId", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "runtime_endpoints"
WHERE "defaultAuthPolicyId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "endpoint_auth_policies_endpointId_authPolicyId_key"
ON "endpoint_auth_policies"("endpointId", "authPolicyId");

-- CreateIndex
CREATE INDEX "endpoint_auth_policies_endpointId_position_idx"
ON "endpoint_auth_policies"("endpointId", "position");

-- CreateIndex
CREATE INDEX "endpoint_auth_policies_authPolicyId_idx"
ON "endpoint_auth_policies"("authPolicyId");

-- AddForeignKey
ALTER TABLE "endpoint_auth_policies"
ADD CONSTRAINT "endpoint_auth_policies_endpointId_fkey"
FOREIGN KEY ("endpointId") REFERENCES "runtime_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endpoint_auth_policies"
ADD CONSTRAINT "endpoint_auth_policies_authPolicyId_fkey"
FOREIGN KEY ("authPolicyId") REFERENCES "auth_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
