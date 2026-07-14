CREATE TABLE "installations" (
    "id" TEXT NOT NULL DEFAULT 'installation',
    "publicUrl" TEXT NOT NULL,
    "initializedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installations_pkey" PRIMARY KEY ("id")
);

INSERT INTO "installations" ("id", "publicUrl", "initializedAt", "createdAt", "updatedAt")
SELECT
    'installation',
    COALESCE(
        (SELECT "baseUrl" FROM "environments" WHERE "slug" = 'production' ORDER BY "createdAt" ASC LIMIT 1),
        (SELECT "baseUrl" FROM "environments" ORDER BY "createdAt" ASC LIMIT 1),
        'https://configured.invalid'
    ),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "users");
