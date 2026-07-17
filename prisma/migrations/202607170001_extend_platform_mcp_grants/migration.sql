UPDATE "oauth_grants"
SET "refreshExpiresAt" = GREATEST(
  "refreshExpiresAt",
  "createdAt" + INTERVAL '90 days'
)
WHERE "revokedAt" IS NULL
  AND "refreshTokenHash" IS NOT NULL
  AND "refreshExpiresAt" > CURRENT_TIMESTAMP;
