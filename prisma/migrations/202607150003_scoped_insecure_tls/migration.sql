-- AlterTable
ALTER TABLE "network_policies"
ADD COLUMN "allowInsecureTlsHosts" JSONB NOT NULL DEFAULT '[]';
