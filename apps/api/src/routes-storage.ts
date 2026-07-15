import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Ajv } from "ajv";
import { Prisma, decryptSecret, prisma } from "@mcpops/db";
import {
  canonicalJson,
  collectionDefinitionSchema,
  collectionFieldPathSchema,
  collectionPermissionsSchema,
  collectionQuerySchema,
  redactSensitive,
  type CollectionQuery,
  type CollectionWhere,
} from "@mcpops/shared";
import { z } from "zod";
import { requireRole } from "./auth.js";
import { parse, sessionContext } from "./helpers.js";
import { cacheInspector } from "./resources.js";

const environmentTenantSchema = z
  .object({
    environmentId: z.string().uuid(),
    tenantId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._-]+$/),
  })
  .strict();
const recordCreateSchema = environmentTenantSchema.extend({
  data: z.record(z.unknown()),
});
const recordUpdateSchema = recordCreateSchema.extend({
  revision: z.number().int().positive(),
});
const recordDeleteSchema = environmentTenantSchema.extend({
  revision: z.number().int().positive(),
});
const recordQuerySchema = environmentTenantSchema.extend(collectionQuerySchema.shape);
const grantSchema = z
  .object({
    functionId: z.string().uuid(),
    permissions: collectionPermissionsSchema,
  })
  .strict();
const cacheListSchema = z
  .object({
    environmentId: z.string().uuid(),
    cursor: z.string().regex(/^\d+$/).default("0"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    functionId: z.string().uuid().optional(),
    tenantId: z.string().max(128).optional(),
    prefix: z.string().max(256).optional(),
  })
  .strict();
const cacheTokenSchema = z
  .object({ environmentId: z.string().uuid(), keyToken: z.string().max(4_096) })
  .strict();

export async function registerStorageRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/data-collections", async (request) => {
    const session = sessionContext(request);
    const environmentId = z
      .string()
      .uuid()
      .optional()
      .parse((request.query as { environmentId?: unknown }).environmentId);
    if (environmentId) await assertEnvironment(session.projectId, environmentId);
    const rows = await prisma.dataCollection.findMany({
      where: { projectId: session.projectId },
      include: {
        versions: { orderBy: { version: "desc" }, take: 1 },
        grants: {
          include: { function: { select: { id: true, name: true, slug: true } } },
        },
        ...(environmentId
          ? { _count: { select: { records: { where: { environmentId } } } } }
          : {}),
      },
      orderBy: { name: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      latestVersion: row.versions[0] ?? null,
      grants: row.grants.map((grant) => ({
        id: grant.id,
        functionId: grant.functionId,
        permissions: grant.permissions,
        enabled: grant.enabled,
        function: grant.function,
      })),
      recordCount: "_count" in row ? row._count.records : null,
    }));
  });

  app.post("/api/data-collections", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const input = parse(collectionDefinitionSchema, request.body);
    validateDefinition(input.schema, input.indexes);
    const result = await prisma.$transaction(async (tx) => {
      const collection = await tx.dataCollection.create({
        data: {
          projectId: session.projectId,
          name: input.name,
          slug: input.slug,
          description: input.description,
        },
      });
      const version = await tx.dataCollectionVersion.create({
        data: {
          collectionId: collection.id,
          version: 1,
          schema: input.schema as Prisma.InputJsonValue,
          indexes: input.indexes as Prisma.InputJsonValue,
          checksum: definitionChecksum(input.schema, input.indexes),
        },
      });
      await audit(tx, session, "data_collection.created", collection.id, {
        slug: collection.slug,
        version: 1,
      });
      return { ...collection, latestVersion: version, grants: [], recordCount: 0 };
    });
    return reply.status(201).send(result);
  });

  app.post("/api/data-collections/:collectionId/versions", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const { collectionId } = request.params as { collectionId: string };
    const input = parse(
      z
        .object({ schema: z.record(z.unknown()), indexes: z.array(z.unknown()) })
        .strict(),
      request.body,
    );
    const parsedDefinition = collectionDefinitionSchema.parse({
      name: "Collection version",
      slug: "collection_version",
      description: "",
      ...input,
    });
    const definition = {
      schema: parsedDefinition.schema,
      indexes: parsedDefinition.indexes,
    };
    validateDefinition(definition.schema, definition.indexes);
    const collection = await scopedCollection(session.projectId, collectionId);
    const latest = await prisma.dataCollectionVersion.findFirstOrThrow({
      where: { collectionId },
      orderBy: { version: "desc" },
    });
    const records = await prisma.collectionRecord.count({ where: { collectionId } });
    if (records > 0 && !compatibleSchema(latest.schema, definition.schema))
      throw Object.assign(
        new Error("Incompatible schema changes require an empty collection"),
        { statusCode: 409, code: "INCOMPATIBLE_SCHEMA" },
      );
    const version = await prisma.$transaction(async (tx) => {
      const created = await tx.dataCollectionVersion.create({
        data: {
          collectionId,
          version: latest.version + 1,
          schema: definition.schema as Prisma.InputJsonValue,
          indexes: definition.indexes as Prisma.InputJsonValue,
          checksum: definitionChecksum(definition.schema, definition.indexes),
        },
      });
      await audit(tx, session, "data_collection.version_created", collectionId, {
        slug: collection.slug,
        version: created.version,
      });
      return created;
    });
    return reply.status(201).send(version);
  });

  app.put("/api/data-collections/:collectionId/grants", async (request) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { collectionId } = request.params as { collectionId: string };
    const input = parse(grantSchema, request.body);
    await scopedCollection(session.projectId, collectionId);
    const fn = await prisma.function.findFirst({
      where: { id: input.functionId, projectId: session.projectId },
      select: { id: true },
    });
    if (!fn) throw notFound("Function not found");
    const grant = await prisma.functionCollectionGrant.upsert({
      where: {
        functionId_collectionId: { functionId: input.functionId, collectionId },
      },
      create: {
        functionId: input.functionId,
        collectionId,
        permissions: input.permissions,
      },
      update: { permissions: input.permissions, enabled: true },
    });
    await audit(prisma, session, "data_collection.granted", grant.id, {
      collectionId,
      functionId: input.functionId,
      permissions: input.permissions,
    });
    return grant;
  });

  app.delete(
    "/api/data-collections/:collectionId/grants/:grantId",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin"]);
      const { collectionId, grantId } = request.params as {
        collectionId: string;
        grantId: string;
      };
      await scopedCollection(session.projectId, collectionId);
      const deleted = await prisma.functionCollectionGrant.deleteMany({
        where: { id: grantId, collectionId },
      });
      if (!deleted.count) throw notFound("Collection grant not found");
      await audit(prisma, session, "data_collection.revoked", grantId, {
        collectionId,
      });
      return reply.status(204).send();
    },
  );

  app.post("/api/data-collections/:collectionId/records/query", async (request) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { collectionId } = request.params as { collectionId: string };
    const input = parse(recordQuerySchema, request.body);
    const definition = await activeDefinition(
      session.projectId,
      collectionId,
      input.environmentId,
    );
    const { environmentId, tenantId, ...query } = input;
    const result = await queryRecords(
      session.projectId,
      environmentId,
      collectionId,
      tenantId,
      query,
      definition.schema,
      definition.indexes,
    );
    return redactSensitive(
      result,
      await knownSecrets(session.projectId, environmentId),
    );
  });

  app.post("/api/data-collections/:collectionId/records", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { collectionId } = request.params as { collectionId: string };
    const input = parse(recordCreateSchema, request.body);
    const definition = await activeDefinition(
      session.projectId,
      collectionId,
      input.environmentId,
    );
    validateRecord(definition.schema, input.data);
    const secrets = await knownSecrets(session.projectId, input.environmentId);
    rejectSecretData(input.data, secrets);
    const row = await prisma.collectionRecord.create({
      data: {
        projectId: session.projectId,
        environmentId: input.environmentId,
        collectionId,
        schemaVersionId: definition.id,
        tenantScope: input.tenantId,
        data: input.data as Prisma.InputJsonValue,
      },
    });
    await audit(prisma, session, "collection_record.created", row.id, {
      collectionId,
      environmentId: input.environmentId,
      tenantId: input.tenantId,
    });
    return reply.status(201).send(redactSensitive(row, secrets));
  });

  app.put("/api/data-collections/:collectionId/records/:recordId", async (request) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const { collectionId, recordId } = request.params as {
      collectionId: string;
      recordId: string;
    };
    const input = parse(recordUpdateSchema, request.body);
    const definition = await activeDefinition(
      session.projectId,
      collectionId,
      input.environmentId,
    );
    validateRecord(definition.schema, input.data);
    const secrets = await knownSecrets(session.projectId, input.environmentId);
    rejectSecretData(input.data, secrets);
    const updated = await prisma.collectionRecord.updateMany({
      where: {
        id: recordId,
        projectId: session.projectId,
        environmentId: input.environmentId,
        collectionId,
        tenantScope: input.tenantId,
        revision: input.revision,
      },
      data: {
        data: input.data as Prisma.InputJsonValue,
        schemaVersionId: definition.id,
        revision: { increment: 1 },
      },
    });
    if (!updated.count) throw conflict();
    const row = await prisma.collectionRecord.findUniqueOrThrow({
      where: { id: recordId },
    });
    await audit(prisma, session, "collection_record.updated", recordId, {
      collectionId,
      revision: row.revision,
    });
    return redactSensitive(row, secrets);
  });

  app.delete(
    "/api/data-collections/:collectionId/records/:recordId",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin"]);
      const { collectionId, recordId } = request.params as {
        collectionId: string;
        recordId: string;
      };
      const input = parse(recordDeleteSchema, request.body);
      await activeDefinition(session.projectId, collectionId, input.environmentId);
      const deleted = await prisma.collectionRecord.deleteMany({
        where: {
          id: recordId,
          projectId: session.projectId,
          environmentId: input.environmentId,
          collectionId,
          tenantScope: input.tenantId,
          revision: input.revision,
        },
      });
      if (!deleted.count) throw conflict();
      await audit(prisma, session, "collection_record.deleted", recordId, {
        collectionId,
        environmentId: input.environmentId,
        tenantId: input.tenantId,
      });
      return reply.status(204).send();
    },
  );

  app.get("/api/storage/cache", async (request) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const input = parse(cacheListSchema, request.query);
    await assertEnvironment(session.projectId, input.environmentId);
    if (cacheInspector.status === "wait") await cacheInspector.connect();
    const prefix = `mcpops:${session.projectId}:${input.environmentId}:`;
    const match = `${prefix}${input.functionId ?? "*"}:${input.tenantId ?? "*"}:${input.prefix ?? "*"}*`;
    const [nextCursor, keys] = await cacheInspector.scan(
      input.cursor,
      "MATCH",
      match,
      "COUNT",
      Math.max(100, input.limit * 4),
    );
    const selected = keys.slice(0, input.limit);
    const pipeline = cacheInspector.pipeline();
    for (const key of selected) pipeline.pttl(key).strlen(key);
    const metadata = await pipeline.exec();
    return {
      cursor: nextCursor,
      items: selected.map((key, index) => {
        const parts = key.split(":");
        const ttlMs = Number(metadata?.[index * 2]?.[1] ?? -1);
        const sizeBytes = Number(metadata?.[index * 2 + 1]?.[1] ?? 0);
        return {
          keyToken: Buffer.from(key).toString("base64url"),
          functionId: parts[3] ?? "",
          tenantId: parts[4] === "_" ? null : (parts[4] ?? null),
          key: parts.slice(5).join(":"),
          ttlMs: ttlMs < 0 ? null : ttlMs,
          sizeBytes,
        };
      }),
    };
  });

  app.post("/api/storage/cache/reveal", async (request) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const input = parse(cacheTokenSchema, request.body);
    await assertEnvironment(session.projectId, input.environmentId);
    const key = decodeKey(input.keyToken);
    assertCacheKey(key, session.projectId, input.environmentId);
    if (cacheInspector.status === "wait") await cacheInspector.connect();
    const size = await cacheInspector.strlen(key);
    if (size > 262_144)
      throw Object.assign(new Error("Cached value exceeds the 256 KiB reveal limit"), {
        statusCode: 413,
        code: "CACHE_VALUE_TOO_LARGE",
      });
    const raw = await cacheInspector.get(key);
    if (raw === null) throw notFound("Cached value no longer exists");
    const secrets = await knownSecrets(session.projectId, input.environmentId);
    const value = redactSensitive(JSON.parse(raw) as unknown, secrets);
    await audit(prisma, session, "function_cache.value_revealed", cacheKeyDigest(key), {
      environmentId: input.environmentId,
      sizeBytes: size,
    });
    return { value, sizeBytes: size };
  });

  app.delete("/api/storage/cache/key", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin"]);
    const input = parse(cacheTokenSchema, request.body);
    await assertEnvironment(session.projectId, input.environmentId);
    const key = decodeKey(input.keyToken);
    assertCacheKey(key, session.projectId, input.environmentId);
    if (cacheInspector.status === "wait") await cacheInspector.connect();
    const deleted = await cacheInspector.unlink(key);
    await audit(prisma, session, "function_cache.key_deleted", cacheKeyDigest(key), {
      environmentId: input.environmentId,
      deleted,
    });
    return reply.status(204).send();
  });
}

async function queryRecords(
  projectId: string,
  environmentId: string,
  collectionId: string,
  tenantId: string,
  query: CollectionQuery,
  schema: unknown,
  indexes: unknown,
) {
  const order = query.orderBy.length
    ? query.orderBy
    : [{ field: "createdAt" as const, direction: "asc" as const }];
  const cursor = query.cursor ? decodeRecordCursor(query.cursor) : undefined;
  const clauses = [
    Prisma.sql`"projectId" = ${projectId}::uuid`,
    Prisma.sql`"environmentId" = ${environmentId}::uuid`,
    Prisma.sql`"collectionId" = ${collectionId}::uuid`,
    Prisma.sql`"tenantScope" = ${tenantId}`,
    ...(query.where ? [compileWhere(query.where, schema)] : []),
    ...(cursor ? [compileRecordCursor(order, cursor, schema)] : []),
  ];
  const ordering = [
    ...order.map(
      (item) =>
        Prisma.sql`${fieldExpression(item.field, schema)} ${Prisma.raw(`${item.direction.toUpperCase()} NULLS LAST`)}`,
    ),
    Prisma.sql`"id" ASC`,
  ];
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('statement_timeout', '5000', true)`;
    return tx.$queryRaw<
      Array<{
        id: string;
        data: unknown;
        revision: number;
        createdAt: Date;
        updatedAt: Date;
      }>
    >(Prisma.sql`
      SELECT "id", "data", "revision", "createdAt", "updatedAt"
      FROM "collection_records"
      WHERE ${Prisma.join(clauses, " AND ")}
      ORDER BY ${Prisma.join(ordering, ", ")}
      LIMIT ${query.limit + 1}
    `);
  });
  const hasMore = rows.length > query.limit;
  const items = rows.slice(0, query.limit);
  return {
    items: items.map((row) => ({
      ...row,
      data: query.select?.length ? selectFields(row.data, query.select) : row.data,
    })),
    ...(hasMore && items.at(-1)
      ? {
          nextCursor: Buffer.from(
            JSON.stringify({
              values: order.map((item) => recordFieldValue(items.at(-1)!, item.field)),
              id: items.at(-1)!.id,
            }),
          ).toString("base64url"),
        }
      : {}),
    warnings: indexCoverageWarnings(query, indexes),
  };
}

function indexCoverageWarnings(query: CollectionQuery, rawIndexes: unknown): string[] {
  const indexes = Array.isArray(rawIndexes)
    ? rawIndexes.filter(
        (item): item is { kind: string; fields: string[] } =>
          !!item &&
          typeof item === "object" &&
          Array.isArray((item as { fields?: unknown }).fields),
      )
    : [];
  const fields = new Set<string>();
  const visit = (where: CollectionWhere): void => {
    if ("and" in where) where.and.forEach(visit);
    else if ("or" in where) where.or.forEach(visit);
    else if ("not" in where) visit(where.not);
    else fields.add(where.field);
  };
  if (query.where) visit(query.where);
  for (const order of query.orderBy)
    if (!["id", "createdAt", "updatedAt"].includes(order.field))
      fields.add(order.field);
  const uncovered = [...fields].filter(
    (field) => !indexes.some((index) => index.fields[0] === field),
  );
  return uncovered.length
    ? [
        `No leading declared index covers: ${uncovered.join(", ")}. PostgreSQL may scan.`,
      ]
    : [];
}

type RecordCursor = { values: unknown[]; id: string };
function compileRecordCursor(
  order: CollectionQuery["orderBy"],
  cursor: RecordCursor,
  schema: unknown,
): Prisma.Sql {
  if (cursor.values.length !== order.length)
    throw Object.assign(new Error("Cursor does not match the query ordering"), {
      statusCode: 400,
      code: "INVALID_CURSOR",
    });
  const branches: Prisma.Sql[] = [];
  for (let index = 0; index <= order.length; index += 1) {
    const equal = order
      .slice(0, index)
      .map(
        (item, position) =>
          Prisma.sql`${fieldExpression(item.field, schema)} IS NOT DISTINCT FROM ${recordCursorValue(item.field, cursor.values[position], schema)}`,
      );
    if (index === order.length) {
      branches.push(
        Prisma.sql`(${Prisma.join([...equal, Prisma.sql`"id" > ${cursor.id}::uuid`], " AND ")})`,
      );
      break;
    }
    const item = order[index]!;
    const expression = fieldExpression(item.field, schema);
    const comparison =
      cursor.values[index] === null
        ? Prisma.sql`FALSE`
        : Prisma.sql`(${expression} ${Prisma.raw(item.direction === "desc" ? "<" : ">")} ${recordCursorValue(item.field, cursor.values[index], schema)} OR ${expression} IS NULL)`;
    branches.push(Prisma.sql`(${Prisma.join([...equal, comparison], " AND ")})`);
  }
  return Prisma.sql`(${Prisma.join(branches, " OR ")})`;
}
function recordCursorValue(field: string, value: unknown, schema: unknown) {
  if (field === "id") return Prisma.sql`${value}::uuid`;
  if (field === "createdAt" || field === "updatedAt")
    return Prisma.sql`${value}::timestamptz`;
  const type = fieldDefinition(schema, field).type;
  if (type === "number" || type === "integer") return Prisma.sql`${value}::numeric`;
  if (type === "boolean") return Prisma.sql`${value}::boolean`;
  return Prisma.sql`${value}::text`;
}

function compileWhere(where: CollectionWhere, schema: unknown): Prisma.Sql {
  if ("and" in where)
    return Prisma.sql`(${Prisma.join(
      where.and.map((item) => compileWhere(item, schema)),
      " AND ",
    )})`;
  if ("or" in where)
    return Prisma.sql`(${Prisma.join(
      where.or.map((item) => compileWhere(item, schema)),
      " OR ",
    )})`;
  if ("not" in where) return Prisma.sql`NOT (${compileWhere(where.not, schema)})`;
  fieldDefinition(schema, where.field);
  const json = Prisma.sql`"data" #> ${where.field.split(".")}::text[]`;
  const text = Prisma.sql`"data" #>> ${where.field.split(".")}::text[]`;
  switch (where.op) {
    case "eq":
      return Prisma.sql`${json} = ${JSON.stringify(where.value)}::jsonb`;
    case "ne":
      return Prisma.sql`${json} IS DISTINCT FROM ${JSON.stringify(where.value)}::jsonb`;
    case "in":
    case "notIn": {
      if (!Array.isArray(where.value) || !where.value.length)
        throw new Error("List filter requires values");
      const test = Prisma.sql`(${Prisma.join(
        where.value.map(
          (value) => Prisma.sql`${json} = ${JSON.stringify(value)}::jsonb`,
        ),
        " OR ",
      )})`;
      return where.op === "notIn" ? Prisma.sql`NOT ${test}` : test;
    }
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const op = { lt: "<", lte: "<=", gt: ">", gte: ">=" }[where.op];
      return Prisma.sql`${fieldExpression(where.field, schema)} ${Prisma.raw(op)} ${where.value}`;
    }
    case "isNull":
      return where.value === false
        ? Prisma.sql`(${json} IS NOT NULL AND ${json} <> 'null'::jsonb)`
        : Prisma.sql`(${json} IS NULL OR ${json} = 'null'::jsonb)`;
    case "contains":
      return Prisma.sql`${text} ILIKE ${`%${escapeLike(String(where.value))}%`} ESCAPE '\\'`;
    case "startsWith":
      return Prisma.sql`${text} ILIKE ${`${escapeLike(String(where.value))}%`} ESCAPE '\\'`;
    case "endsWith":
      return Prisma.sql`${text} ILIKE ${`%${escapeLike(String(where.value))}`} ESCAPE '\\'`;
    case "arrayContains":
      return Prisma.sql`${json} @> ${JSON.stringify([where.value])}::jsonb`;
  }
}

function fieldExpression(field: string, schema: unknown): Prisma.Sql {
  if (field === "id") return Prisma.sql`"id"`;
  if (field === "createdAt") return Prisma.sql`"createdAt"`;
  if (field === "updatedAt") return Prisma.sql`"updatedAt"`;
  const definition = fieldDefinition(schema, field);
  const text = Prisma.sql`"data" #>> ${field.split(".")}::text[]`;
  if (definition.type === "number" || definition.type === "integer")
    return Prisma.sql`NULLIF(${text}, '')::numeric`;
  if (definition.type === "boolean") return Prisma.sql`NULLIF(${text}, '')::boolean`;
  return text;
}

function validateDefinition(
  schema: Record<string, unknown>,
  indexes: Array<{ fields: string[] }>,
) {
  new Ajv({ allErrors: true, strict: false }).compile(schema);
  for (const index of indexes)
    for (const field of index.fields) fieldDefinition(schema, field);
}
function validateRecord(schema: unknown, data: unknown) {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(
    schema as object,
  );
  if (!validate(data))
    throw Object.assign(new Error("Record does not match the collection schema"), {
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });
}
function fieldDefinition(schema: unknown, field: string): Record<string, unknown> {
  collectionFieldPathSchema.parse(field);
  let current = schema as Record<string, unknown>;
  for (const part of field.split(".")) {
    const properties = current.properties as Record<string, unknown> | undefined;
    const next = properties?.[part];
    if (!next || typeof next !== "object" || Array.isArray(next))
      throw Object.assign(new Error(`Unknown collection field '${field}'`), {
        statusCode: 400,
        code: "INVALID_COLLECTION_FIELD",
      });
    current = next as Record<string, unknown>;
  }
  return current;
}
function compatibleSchema(previous: unknown, next: unknown): boolean {
  const left = previous as Record<string, unknown>;
  const right = next as Record<string, unknown>;
  const oldRequired = new Set(Array.isArray(left.required) ? left.required : []);
  const newRequired = new Set(Array.isArray(right.required) ? right.required : []);
  for (const field of newRequired) if (!oldRequired.has(field)) return false;
  const oldProperties = (left.properties ?? {}) as Record<string, unknown>;
  const newProperties = (right.properties ?? {}) as Record<string, unknown>;
  for (const [name, definition] of Object.entries(oldProperties)) {
    const replacement = newProperties[name];
    if (!replacement) return false;
    if (
      (definition as Record<string, unknown>).type !==
      (replacement as Record<string, unknown>).type
    )
      return false;
  }
  return true;
}
function definitionChecksum(schema: unknown, indexes: unknown): string {
  return createHash("sha256").update(canonicalJson({ schema, indexes })).digest("hex");
}
function cacheKeyDigest(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
async function scopedCollection(projectId: string, id: string) {
  const collection = await prisma.dataCollection.findFirst({
    where: { id, projectId },
  });
  if (!collection) throw notFound("Data collection not found");
  return collection;
}
async function activeDefinition(
  projectId: string,
  collectionId: string,
  environmentId: string,
) {
  await assertEnvironment(projectId, environmentId);
  await scopedCollection(projectId, collectionId);
  const environment = await prisma.environment.findUnique({
    where: { id: environmentId },
    select: {
      activeProjectDeployment: {
        select: { endpointDeployments: { select: { snapshot: true } } },
      },
    },
  });
  const snapshots = environment?.activeProjectDeployment?.endpointDeployments ?? [];
  const pinned = snapshots
    .flatMap((artifact) => {
      const snapshot = artifact.snapshot as Record<string, unknown>;
      return Array.isArray(snapshot.collections) ? snapshot.collections : [];
    })
    .find(
      (item) =>
        item &&
        typeof item === "object" &&
        (item as Record<string, unknown>).collectionId === collectionId,
    ) as Record<string, unknown> | undefined;
  if (!pinned)
    throw Object.assign(new Error("Collection is not active in this environment"), {
      statusCode: 409,
      code: "COLLECTION_NOT_DEPLOYED",
    });
  return prisma.dataCollectionVersion.findFirstOrThrow({
    where: { id: String(pinned.schemaVersionId), collectionId },
  });
}
async function assertEnvironment(projectId: string, environmentId: string) {
  const found = await prisma.environment.findFirst({
    where: { id: environmentId, projectId },
  });
  if (!found) throw notFound("Environment not found");
}
async function audit(
  client: Pick<typeof prisma, "auditEvent">,
  session: ReturnType<typeof sessionContext>,
  action: string,
  targetId: string,
  metadata: Record<string, unknown>,
) {
  await client.auditEvent.create({
    data: {
      projectId: session.projectId,
      actorType: "user",
      actorId: session.userId,
      action,
      targetType: action.startsWith("collection_record")
        ? "collection_record"
        : action.startsWith("function_cache")
          ? "function_cache"
          : "data_collection",
      targetId,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}
async function knownSecrets(
  projectId: string,
  environmentId: string,
): Promise<string[]> {
  const rows = await prisma.secret.findMany({
    where: { projectId, environmentId },
    select: { encryptedValue: true },
  });
  return rows.flatMap((row) => {
    if (!row.encryptedValue) return [];
    try {
      return [decryptSecret(row.encryptedValue)];
    } catch {
      return [];
    }
  });
}
function selectFields(data: unknown, fields: string[]) {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    let value = data;
    for (const part of field.split("."))
      value =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : null;
    result[field] = value;
  }
  return result;
}
function decodeRecordCursor(value: string): RecordCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as RecordCursor;
    z.string().uuid().parse(parsed.id);
    if (!Array.isArray(parsed.values)) throw new Error();
    return parsed;
  } catch {
    throw Object.assign(new Error("Invalid record cursor"), {
      statusCode: 400,
      code: "INVALID_CURSOR",
    });
  }
}
function recordFieldValue(
  row: { id: string; data: unknown; createdAt: Date; updatedAt: Date },
  field: string,
): unknown {
  if (field === "id") return row.id;
  if (field === "createdAt") return row.createdAt.toISOString();
  if (field === "updatedAt") return row.updatedAt.toISOString();
  let value = row.data;
  for (const part of field.split("."))
    value =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)[part]
        : null;
  return value ?? null;
}
function decodeKey(value: string): string {
  try {
    const key = Buffer.from(value, "base64url").toString("utf8");
    if (!key) throw new Error();
    return key;
  } catch {
    throw Object.assign(new Error("Invalid cache key token"), {
      statusCode: 400,
      code: "INVALID_CACHE_KEY",
    });
  }
}
function assertCacheKey(key: string, projectId: string, environmentId: string) {
  if (!key.startsWith(`mcpops:${projectId}:${environmentId}:`))
    throw Object.assign(new Error("Cache key is outside the selected scope"), {
      statusCode: 403,
      code: "FORBIDDEN",
    });
}
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}
function notFound(message: string) {
  return Object.assign(new Error(message), { statusCode: 404, code: "NOT_FOUND" });
}
function conflict() {
  return Object.assign(
    new Error("Record was changed or deleted by another operation"),
    { statusCode: 409, code: "REVISION_CONFLICT" },
  );
}
function rejectSecretData(value: unknown, secrets: readonly string[]): void {
  const contains = (item: unknown): boolean => {
    if (typeof item === "string")
      return (
        item === "[REDACTED]" ||
        secrets.some((secret) => secret.length >= 4 && item.includes(secret))
      );
    if (!item || typeof item !== "object") return false;
    return Object.values(item).some(contains);
  };
  if (contains(value))
    throw Object.assign(
      new Error(
        "Secret values and redacted placeholders cannot be stored in collections",
      ),
      { statusCode: 400, code: "SECRET_VALUE_REJECTED" },
    );
}
