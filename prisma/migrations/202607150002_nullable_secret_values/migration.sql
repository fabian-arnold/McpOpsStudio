-- Logical Secrets may be declared before an environment-specific value is set.
-- Runtime resolution already treats a missing encrypted value as unavailable.
ALTER TABLE "secrets" ALTER COLUMN "encryptedValue" DROP NOT NULL;
