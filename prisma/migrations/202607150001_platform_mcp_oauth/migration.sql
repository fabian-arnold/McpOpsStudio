CREATE TABLE "oauth_clients" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "redirectUris" JSONB NOT NULL,
  "metadataUri" TEXT,
  "registration" TEXT NOT NULL DEFAULT 'dynamic',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_authorization_codes" (
  "id" UUID NOT NULL,
  "codeHash" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "resource" TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_grants" (
  "id" UUID NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "accessTokenHash" TEXT NOT NULL,
  "refreshTokenHash" TEXT,
  "scopes" TEXT[] NOT NULL,
  "resource" TEXT NOT NULL,
  "accessExpiresAt" TIMESTAMP(3) NOT NULL,
  "refreshExpiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "oauth_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_authorization_codes_codeHash_key" ON "oauth_authorization_codes"("codeHash");
CREATE INDEX "oauth_authorization_codes_clientId_expiresAt_idx" ON "oauth_authorization_codes"("clientId", "expiresAt");
CREATE UNIQUE INDEX "oauth_grants_accessTokenHash_key" ON "oauth_grants"("accessTokenHash");
CREATE UNIQUE INDEX "oauth_grants_refreshTokenHash_key" ON "oauth_grants"("refreshTokenHash");
CREATE INDEX "oauth_grants_userId_revokedAt_idx" ON "oauth_grants"("userId", "revokedAt");
CREATE INDEX "oauth_grants_clientId_revokedAt_idx" ON "oauth_grants"("clientId", "revokedAt");
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
