/* eslint-disable max-lines */
import { z } from "zod";
import { Prisma, prisma } from "@mcpops/db";
import {
  collectionDefinitionSchema,
  collectionPermissionsSchema,
  redactSensitive,
} from "@mcpops/shared";
import type { PlatformScope } from "./oauth.js";
import { cacheInspector } from "./resources.js";
import {
  activeDefinition,
  assertCacheKey,
  assertEnvironment,
  cacheKeyDigest,
  cacheListSchema,
  cacheTokenSchema,
  compatibleSchema,
  conflict,
  decodeKey,
  definitionChecksum,
  knownSecrets,
  queryRecords,
  recordCreateSchema,
  recordDeleteSchema,
  recordQuerySchema,
  recordUpdateSchema,
  rejectSecretData,
  validateDefinition,
  validateRecord,
} from "./routes-storage.js";

type Actor = { userId: string; role: string; scopes: PlatformScope[] };

const collectionReferenceSchema = z.object({ collection: z.string().min(1) }).strict();
const collectionListSchema = z
  .object({ environment: z.string().min(1).optional() })
  .strict();
const createSchema = z
  .object({ definition: collectionDefinitionSchema, dryRun: z.boolean().default(true) })
  .strict();
const versionSchema = z
  .object({
    collection: z.string().min(1),
    schema: z.record(z.unknown()),
    indexes: z.array(z.unknown()),
    dryRun: z.boolean().default(true),
  })
  .strict();
const grantSchema = z
  .object({
    collection: z.string().min(1),
    function: z.string().min(1),
    permissions: collectionPermissionsSchema,
    dryRun: z.boolean().default(true),
  })
  .strict();
const querySchema = z
  .object({ collection: z.string().min(1), query: recordQuerySchema })
  .strict();
const createRecordSchema = z
  .object({
    collection: z.string().min(1),
    record: recordCreateSchema,
    dryRun: z.boolean().default(true),
  })
  .strict();
const updateRecordSchema = z
  .object({
    collection: z.string().min(1),
    recordId: z.string().uuid(),
    record: recordUpdateSchema,
    dryRun: z.boolean().default(true),
  })
  .strict();
const deleteRecordSchema = z
  .object({
    collection: z.string().min(1),
    recordId: z.string().uuid(),
    scope: recordDeleteSchema,
    dryRun: z.boolean().default(true),
  })
  .strict();
const cacheListToolSchema = z
  .object({
    environment: z.string().min(1),
    options: cacheListSchema.omit({ environmentId: true }),
  })
  .strict();
const cacheKeyToolSchema = z
  .object({
    environment: z.string().min(1),
    keyToken: cacheTokenSchema.shape.keyToken,
    dryRun: z.boolean().default(true),
  })
  .strict();

export const storageToolNames = new Set([
  "storage_collections_list",
  "storage_collection_get",
  "storage_collection_create",
  "storage_collection_version_create",
  "storage_collection_grant_set",
  "storage_collection_grant_delete",
  "storage_records_query",
  "storage_record_create",
  "storage_record_update",
  "storage_record_delete",
  "storage_cache_list",
  "storage_cache_reveal",
  "storage_cache_delete",
]);

export const storageTools = [
  platformTool(
    "storage_collections_list",
    "List typed PostgreSQL collections, immutable versions, and Function grants.",
    { environment: stringField("Optional environment ID or slug for record counts") },
    [],
    true,
  ),
  platformTool(
    "storage_collection_get",
    "Inspect one typed collection and its immutable version history.",
    { collection: stringField("Collection ID or slug") },
    ["collection"],
    true,
  ),
  platformTool(
    "storage_collection_create",
    "Preview or create a typed PostgreSQL collection.",
    {
      definition: objectField(
        "Collection name, slug, description, JSON Schema, and indexes",
      ),
      dryRun: booleanField("Preview without creating", true),
    },
    ["definition"],
    false,
  ),
  platformTool(
    "storage_collection_version_create",
    "Preview or create an immutable collection schema version.",
    {
      collection: stringField("Collection ID or slug"),
      schema: objectField("JSON Schema"),
      indexes: arrayField("Declared collection indexes"),
      dryRun: booleanField("Preview without creating", true),
    },
    ["collection", "schema", "indexes"],
    false,
  ),
  platformTool(
    "storage_collection_grant_set",
    "Preview or set explicit read, write, and delete permissions for one Function.",
    {
      collection: stringField("Collection ID or slug"),
      function: stringField("Function ID or slug"),
      permissions: stringArrayField("Any of read, write, delete"),
      dryRun: booleanField("Preview without saving", true),
    },
    ["collection", "function", "permissions"],
    false,
  ),
  platformTool(
    "storage_collection_grant_delete",
    "Preview or revoke a Function's access to one collection.",
    {
      collection: stringField("Collection ID or slug"),
      function: stringField("Function ID or slug"),
      dryRun: booleanField("Preview without revoking", true),
    },
    ["collection", "function"],
    false,
  ),
  platformTool(
    "storage_records_query",
    "Run a bounded tenant-scoped collection query in PostgreSQL.",
    {
      collection: stringField("Collection ID or slug"),
      query: objectField(
        "Environment ID, tenant ID, filters, ordering, projection, limit, and cursor",
      ),
    },
    ["collection", "query"],
    true,
  ),
  platformTool(
    "storage_record_create",
    "Preview or create a schema-validated tenant record.",
    {
      collection: stringField("Collection ID or slug"),
      record: objectField("Environment ID, tenant ID, and data"),
      dryRun: booleanField("Preview without creating", true),
    },
    ["collection", "record"],
    false,
  ),
  platformTool(
    "storage_record_update",
    "Preview or update a tenant record using its optimistic revision.",
    {
      collection: stringField("Collection ID or slug"),
      recordId: stringField("Record UUID"),
      record: objectField("Environment ID, tenant ID, revision, and replacement data"),
      dryRun: booleanField("Preview without updating", true),
    },
    ["collection", "recordId", "record"],
    false,
  ),
  platformTool(
    "storage_record_delete",
    "Preview or permanently delete a tenant record using its optimistic revision.",
    {
      collection: stringField("Collection ID or slug"),
      recordId: stringField("Record UUID"),
      scope: objectField("Environment ID, tenant ID, and revision"),
      dryRun: booleanField("Preview without deleting", true),
    },
    ["collection", "recordId", "scope"],
    false,
  ),
  platformTool(
    "storage_cache_list",
    "Scan bounded cache metadata without revealing values.",
    {
      environment: stringField("Environment ID or slug"),
      options: objectField("Cursor, limit, Function ID, tenant ID, and prefix"),
    },
    ["environment", "options"],
    true,
  ),
  platformTool(
    "storage_cache_reveal",
    "Reveal one bounded cached value with secret redaction and auditing.",
    {
      environment: stringField("Environment ID or slug"),
      keyToken: stringField("Opaque key token returned by storage_cache_list"),
    },
    ["environment", "keyToken"],
    false,
  ),
  platformTool(
    "storage_cache_delete",
    "Preview or delete one cache key with auditing.",
    {
      environment: stringField("Environment ID or slug"),
      keyToken: stringField("Opaque key token returned by storage_cache_list"),
      dryRun: booleanField("Preview without deleting", true),
    },
    ["environment", "keyToken"],
    false,
  ),
];

export async function callStorageTool(
  name: string,
  projectId: string,
  actor: Actor,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (name === "storage_collections_list")
    return listCollections(projectId, collectionListSchema.parse(args));
  if (name === "storage_collection_get")
    return getCollection(projectId, collectionReferenceSchema.parse(args).collection);
  if (name === "storage_collection_create")
    return createCollection(projectId, actor, createSchema.parse(args));
  if (name === "storage_collection_version_create")
    return createVersion(projectId, actor, versionSchema.parse(args));
  if (name === "storage_collection_grant_set")
    return setGrant(projectId, actor, grantSchema.parse(args));
  if (name === "storage_collection_grant_delete")
    return deleteGrant(
      projectId,
      actor,
      grantSchema.omit({ permissions: true }).parse(args),
    );
  if (name === "storage_records_query")
    return recordsQuery(projectId, actor, querySchema.parse(args));
  if (name === "storage_record_create")
    return createRecord(projectId, actor, createRecordSchema.parse(args));
  if (name === "storage_record_update")
    return updateRecord(projectId, actor, updateRecordSchema.parse(args));
  if (name === "storage_record_delete")
    return deleteRecord(projectId, actor, deleteRecordSchema.parse(args));
  if (name === "storage_cache_list")
    return listCache(projectId, actor, cacheListToolSchema.parse(args));
  if (name === "storage_cache_reveal")
    return revealCache(
      projectId,
      actor,
      cacheKeyToolSchema.omit({ dryRun: true }).parse(args),
    );
  if (name === "storage_cache_delete")
    return deleteCache(projectId, actor, cacheKeyToolSchema.parse(args));
  throw toolError("UNKNOWN_TOOL", `Unknown storage tool: ${name}`);
}

async function listCollections(
  projectId: string,
  input: z.infer<typeof collectionListSchema>,
) {
  const environment = input.environment
    ? await findEnvironment(projectId, input.environment)
    : undefined;
  const rows = await prisma.dataCollection.findMany({
    where: { projectId },
    include: {
      versions: { orderBy: { version: "desc" } },
      grants: {
        include: { function: { select: { id: true, name: true, slug: true } } },
      },
      ...(environment
        ? {
            _count: {
              select: { records: { where: { environmentId: environment.id } } },
            },
          }
        : {}),
    },
    orderBy: { name: "asc" },
  });
  return output(`${rows.length} collection(s)`, {
    collections: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      enabled: row.enabled,
      latestVersion: row.versions[0] ?? null,
      versionCount: row.versions.length,
      grants: row.grants.map((grant) => ({
        id: grant.id,
        permissions: grant.permissions,
        enabled: grant.enabled,
        function: grant.function,
      })),
      recordCount: "_count" in row ? row._count.records : null,
    })),
    ...(environment ? { environment } : {}),
  });
}

async function getCollection(projectId: string, identifier: string) {
  const collection = await findCollection(projectId, identifier, true);
  return output(collection.name, { collection });
}

async function createCollection(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof createSchema>,
) {
  requireMutation(actor, ["owner", "admin", "developer"]);
  validateDefinition(input.definition.schema, input.definition.indexes);
  if (input.dryRun)
    return preview("Collection definition is valid", { definition: input.definition });
  const result = await prisma.$transaction(async (tx) => {
    const collection = await tx.dataCollection.create({
      data: {
        projectId,
        name: input.definition.name,
        slug: input.definition.slug,
        description: input.definition.description,
      },
    });
    const version = await tx.dataCollectionVersion.create({
      data: {
        collectionId: collection.id,
        version: 1,
        schema: input.definition.schema as Prisma.InputJsonValue,
        indexes: input.definition.indexes as Prisma.InputJsonValue,
        checksum: definitionChecksum(input.definition.schema, input.definition.indexes),
      },
    });
    await writeAudit(
      tx,
      actor,
      projectId,
      "data_collection.created",
      "data_collection",
      collection.id,
      { slug: collection.slug, version: 1 },
    );
    return { ...collection, latestVersion: version };
  });
  return output(`Created ${result.name}`, { collection: result });
}

async function createVersion(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof versionSchema>,
) {
  requireMutation(actor, ["owner", "admin", "developer"]);
  const collection = await findCollection(projectId, input.collection);
  const parsed = collectionDefinitionSchema.parse({
    name: "Collection version",
    slug: "collection_version",
    description: "",
    schema: input.schema,
    indexes: input.indexes,
  });
  validateDefinition(parsed.schema, parsed.indexes);
  const latest = await prisma.dataCollectionVersion.findFirstOrThrow({
    where: { collectionId: collection.id },
    orderBy: { version: "desc" },
  });
  const recordCount = await prisma.collectionRecord.count({
    where: { collectionId: collection.id },
  });
  if (recordCount && !compatibleSchema(latest.schema, parsed.schema))
    throw toolError(
      "INCOMPATIBLE_SCHEMA",
      "Incompatible schema changes require an empty collection",
    );
  if (input.dryRun)
    return preview("Collection version is valid", {
      collection: reference(collection),
      nextVersion: latest.version + 1,
    });
  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.dataCollectionVersion.create({
      data: {
        collectionId: collection.id,
        version: latest.version + 1,
        schema: parsed.schema as Prisma.InputJsonValue,
        indexes: parsed.indexes as Prisma.InputJsonValue,
        checksum: definitionChecksum(parsed.schema, parsed.indexes),
      },
    });
    await writeAudit(
      tx,
      actor,
      projectId,
      "data_collection.version_created",
      "data_collection",
      collection.id,
      { slug: collection.slug, version: created.version },
    );
    return created;
  });
  return output(`Created ${collection.slug} version ${version.version}`, { version });
}

async function setGrant(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof grantSchema>,
) {
  requireMutation(actor, ["owner", "admin"]);
  const [collection, fn] = await Promise.all([
    findCollection(projectId, input.collection),
    findFunction(projectId, input.function),
  ]);
  if (input.dryRun)
    return preview("Collection grant is valid", {
      collection: reference(collection),
      function: reference(fn),
      permissions: input.permissions,
    });
  const grant = await prisma.functionCollectionGrant.upsert({
    where: {
      functionId_collectionId: { functionId: fn.id, collectionId: collection.id },
    },
    create: {
      functionId: fn.id,
      collectionId: collection.id,
      permissions: input.permissions,
    },
    update: { permissions: input.permissions, enabled: true },
  });
  await writeAudit(
    prisma,
    actor,
    projectId,
    "data_collection.granted",
    "data_collection",
    grant.id,
    { collectionId: collection.id, functionId: fn.id, permissions: input.permissions },
  );
  return output(`Granted ${fn.slug} access to ${collection.slug}`, { grant });
}

async function deleteGrant(
  projectId: string,
  actor: Actor,
  input: Omit<z.infer<typeof grantSchema>, "permissions">,
) {
  requireMutation(actor, ["owner", "admin"]);
  const [collection, fn] = await Promise.all([
    findCollection(projectId, input.collection),
    findFunction(projectId, input.function),
  ]);
  const grant = await prisma.functionCollectionGrant.findUnique({
    where: {
      functionId_collectionId: {
        functionId: fn.id,
        collectionId: collection.id,
      },
    },
  });
  if (!grant) throw toolError("NOT_FOUND", "Collection grant not found");
  if (input.dryRun)
    return preview("Collection grant revocation is valid", {
      collection: reference(collection),
      function: reference(fn),
    });
  await prisma.functionCollectionGrant.delete({ where: { id: grant.id } });
  await writeAudit(
    prisma,
    actor,
    projectId,
    "data_collection.revoked",
    "data_collection",
    grant.id,
    { collectionId: collection.id, functionId: fn.id },
  );
  return output(`Revoked ${fn.slug} access to ${collection.slug}`, {
    grantId: grant.id,
    deleted: true,
  });
}

async function recordsQuery(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof querySchema>,
) {
  requireRole(actor, ["owner", "admin"]);
  const collection = await findCollection(projectId, input.collection);
  const definition = await activeDefinition(
    projectId,
    collection.id,
    input.query.environmentId,
  );
  const { environmentId, tenantId, ...query } = input.query;
  const result = await queryRecords(
    projectId,
    environmentId,
    collection.id,
    tenantId,
    query,
    definition.schema,
    definition.indexes,
  );
  return output(`${result.items.length} record(s)`, {
    collection: reference(collection),
    ...(redactSensitive(
      result,
      await knownSecrets(projectId, environmentId),
    ) as object),
  });
}

async function createRecord(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof createRecordSchema>,
) {
  requireMutation(actor, ["owner", "admin"]);
  const collection = await findCollection(projectId, input.collection);
  const definition = await activeDefinition(
    projectId,
    collection.id,
    input.record.environmentId,
  );
  validateRecord(definition.schema, input.record.data);
  const secrets = await knownSecrets(projectId, input.record.environmentId);
  rejectSecretData(input.record.data, secrets);
  if (input.dryRun)
    return preview("Record is valid", {
      collection: reference(collection),
      scope: {
        environmentId: input.record.environmentId,
        tenantId: input.record.tenantId,
      },
    });
  const row = await prisma.collectionRecord.create({
    data: {
      projectId,
      environmentId: input.record.environmentId,
      collectionId: collection.id,
      schemaVersionId: definition.id,
      tenantScope: input.record.tenantId,
      data: input.record.data as Prisma.InputJsonValue,
    },
  });
  await writeAudit(
    prisma,
    actor,
    projectId,
    "collection_record.created",
    "collection_record",
    row.id,
    {
      collectionId: collection.id,
      environmentId: input.record.environmentId,
      tenantId: input.record.tenantId,
    },
    input.record.environmentId,
  );
  return output("Created collection record", { record: redactSensitive(row, secrets) });
}

async function updateRecord(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof updateRecordSchema>,
) {
  requireMutation(actor, ["owner", "admin"]);
  const collection = await findCollection(projectId, input.collection);
  const definition = await activeDefinition(
    projectId,
    collection.id,
    input.record.environmentId,
  );
  validateRecord(definition.schema, input.record.data);
  const secrets = await knownSecrets(projectId, input.record.environmentId);
  rejectSecretData(input.record.data, secrets);
  if (input.dryRun)
    return preview("Record update is valid", {
      recordId: input.recordId,
      expectedRevision: input.record.revision,
    });
  const changed = await prisma.collectionRecord.updateMany({
    where: {
      id: input.recordId,
      projectId,
      environmentId: input.record.environmentId,
      collectionId: collection.id,
      tenantScope: input.record.tenantId,
      revision: input.record.revision,
    },
    data: {
      data: input.record.data as Prisma.InputJsonValue,
      schemaVersionId: definition.id,
      revision: { increment: 1 },
    },
  });
  if (!changed.count) throw conflict();
  const row = await prisma.collectionRecord.findUniqueOrThrow({
    where: { id: input.recordId },
  });
  await writeAudit(
    prisma,
    actor,
    projectId,
    "collection_record.updated",
    "collection_record",
    row.id,
    { collectionId: collection.id, revision: row.revision },
    input.record.environmentId,
  );
  return output("Updated collection record", { record: redactSensitive(row, secrets) });
}

async function deleteRecord(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof deleteRecordSchema>,
) {
  requireMutation(actor, ["owner", "admin"]);
  const collection = await findCollection(projectId, input.collection);
  await activeDefinition(projectId, collection.id, input.scope.environmentId);
  if (input.dryRun)
    return preview("Record deletion is valid", {
      recordId: input.recordId,
      revision: input.scope.revision,
    });
  const deleted = await prisma.collectionRecord.deleteMany({
    where: {
      id: input.recordId,
      projectId,
      environmentId: input.scope.environmentId,
      collectionId: collection.id,
      tenantScope: input.scope.tenantId,
      revision: input.scope.revision,
    },
  });
  if (!deleted.count) throw conflict();
  await writeAudit(
    prisma,
    actor,
    projectId,
    "collection_record.deleted",
    "collection_record",
    input.recordId,
    { collectionId: collection.id, tenantId: input.scope.tenantId },
    input.scope.environmentId,
  );
  return output("Deleted collection record", {
    recordId: input.recordId,
    deleted: true,
  });
}

async function listCache(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof cacheListToolSchema>,
) {
  requireRole(actor, ["owner", "admin"]);
  const environment = await findEnvironment(projectId, input.environment);
  if (cacheInspector.status === "wait") await cacheInspector.connect();
  const prefix = `mcpops:${projectId}:${environment.id}:`;
  const match = `${prefix}${input.options.functionId ?? "*"}:${input.options.tenantId ?? "*"}:${input.options.prefix ?? "*"}*`;
  const [cursor, keys] = await cacheInspector.scan(
    input.options.cursor,
    "MATCH",
    match,
    "COUNT",
    Math.max(100, input.options.limit * 4),
  );
  const selected = keys.slice(0, input.options.limit);
  const pipeline = cacheInspector.pipeline();
  selected.forEach((key) => pipeline.pttl(key).strlen(key));
  const metadata = await pipeline.exec();
  return output(`${selected.length} cache key(s)`, {
    cursor,
    environment,
    items: selected.map((key, index) => {
      const parts = key.split(":");
      const ttl = Number(metadata?.[index * 2]?.[1] ?? -1);
      return {
        keyToken: Buffer.from(key).toString("base64url"),
        functionId: parts[3] ?? "",
        tenantId: parts[4] === "_" ? null : (parts[4] ?? null),
        key: parts.slice(5).join(":"),
        ttlMs: ttl < 0 ? null : ttl,
        sizeBytes: Number(metadata?.[index * 2 + 1]?.[1] ?? 0),
      };
    }),
  });
}

async function revealCache(
  projectId: string,
  actor: Actor,
  input: { environment: string; keyToken: string },
) {
  requireMutation(actor, ["owner", "admin"]);
  const environment = await findEnvironment(projectId, input.environment);
  const key = decodeKey(input.keyToken);
  assertCacheKey(key, projectId, environment.id);
  if (cacheInspector.status === "wait") await cacheInspector.connect();
  const sizeBytes = await cacheInspector.strlen(key);
  if (sizeBytes > 262_144)
    throw toolError(
      "CACHE_VALUE_TOO_LARGE",
      "Cached value exceeds the 256 KiB reveal limit",
    );
  const raw = await cacheInspector.get(key);
  if (raw === null) throw toolError("NOT_FOUND", "Cached value no longer exists");
  const value = redactSensitive(
    JSON.parse(raw) as unknown,
    await knownSecrets(projectId, environment.id),
  );
  await writeAudit(
    prisma,
    actor,
    projectId,
    "function_cache.value_revealed",
    "function_cache",
    cacheKeyDigest(key),
    { environmentId: environment.id, sizeBytes },
    environment.id,
  );
  return output("Revealed redacted cache value", {
    value,
    sizeBytes,
    containsSecretValues: false,
  });
}

async function deleteCache(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof cacheKeyToolSchema>,
) {
  requireMutation(actor, ["owner", "admin"]);
  const environment = await findEnvironment(projectId, input.environment);
  const key = decodeKey(input.keyToken);
  assertCacheKey(key, projectId, environment.id);
  if (input.dryRun)
    return preview("Cache key deletion is valid", {
      keyToken: input.keyToken,
      environment,
    });
  if (cacheInspector.status === "wait") await cacheInspector.connect();
  const deleted = await cacheInspector.unlink(key);
  await writeAudit(
    prisma,
    actor,
    projectId,
    "function_cache.key_deleted",
    "function_cache",
    cacheKeyDigest(key),
    { environmentId: environment.id, deleted },
    environment.id,
  );
  return output("Deleted cache key", { deleted: Boolean(deleted) });
}

async function findCollection(projectId: string, value: string, details = false) {
  const row = await prisma.dataCollection.findFirst({
    where: { projectId, OR: [{ id: safeUuid(value) }, { slug: value }] },
    ...(details
      ? {
          include: {
            versions: { orderBy: { version: "desc" as const } },
            grants: {
              include: { function: { select: { id: true, name: true, slug: true } } },
            },
          },
        }
      : {}),
  });
  if (!row) throw toolError("NOT_FOUND", "Data collection not found");
  return row;
}
async function findEnvironment(projectId: string, value: string) {
  const row = await prisma.environment.findFirst({
    where: { projectId, OR: [{ id: safeUuid(value) }, { slug: value }] },
    select: { id: true, name: true, slug: true },
  });
  if (!row) throw toolError("NOT_FOUND", "Environment not found");
  await assertEnvironment(projectId, row.id);
  return row;
}
async function findFunction(projectId: string, value: string) {
  const row = await prisma.function.findFirst({
    where: { projectId, OR: [{ id: safeUuid(value) }, { slug: value }] },
    select: { id: true, name: true, slug: true },
  });
  if (!row) throw toolError("NOT_FOUND", "Function not found");
  return row;
}
function safeUuid(value: string) {
  return z.string().uuid().safeParse(value).success
    ? value
    : "00000000-0000-0000-0000-000000000000";
}
function reference(value: { id: string; name: string; slug: string }) {
  return { id: value.id, name: value.name, slug: value.slug };
}
function requireMutation(actor: Actor, roles: string[]) {
  requireScope(actor, "mcpops:write");
  requireRole(actor, roles);
}
function requireScope(actor: Actor, scope: PlatformScope) {
  if (!actor.scopes.includes(scope))
    throw toolError("INSUFFICIENT_SCOPE", `Required OAuth scope: ${scope}`);
}
function requireRole(actor: Actor, roles: string[]) {
  if (!roles.includes(actor.role))
    throw toolError("FORBIDDEN", "Your installation role cannot perform this action");
}
async function writeAudit(
  client: Pick<typeof prisma, "auditEvent">,
  actor: Actor,
  projectId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
  environmentId?: string,
) {
  await client.auditEvent.create({
    data: {
      projectId,
      ...(environmentId ? { environmentId } : {}),
      actorType: "user",
      actorId: actor.userId,
      action,
      targetType,
      targetId,
      metadata: { ...metadata, source: "platform_mcp" } as Prisma.InputJsonValue,
    },
  });
}
function preview(summary: string, data: unknown) {
  return { ...output(summary, data), dryRun: true };
}
function output(summary: string, data: unknown) {
  return { summary, data, nextActions: [] };
}
function toolError(code: string, message: string) {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}
function platformTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  readOnly: boolean,
) {
  return {
    name,
    title: name
      .split("_")
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join(" "),
    description,
    inputSchema: {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: !readOnly,
      idempotentHint: readOnly,
    },
  };
}
function stringField(description: string) {
  return { type: "string", description };
}
function objectField(description: string) {
  return { type: "object", description, additionalProperties: true };
}
function booleanField(description: string, defaultValue: boolean) {
  return { type: "boolean", description, default: defaultValue };
}
function arrayField(description: string) {
  return { type: "array", description, items: { type: "object" } };
}
function stringArrayField(description: string) {
  return {
    type: "array",
    description,
    items: { type: "string", enum: ["read", "write", "delete"] },
  };
}
