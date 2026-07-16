import type { FastifyInstance } from "fastify";
import { prisma, type Prisma } from "@mcpops/db";
import {
  collectionDefinitionSchema,
  collectionPermissionsSchema,
  collectionQuerySchema,
  redactSensitive,
} from "@mcpops/shared";
import { z } from "zod";
import { requireRole } from "./auth.js";
import { parse, sessionContext } from "./helpers.js";
import { cacheInspector } from "./resources.js";
import {
  activeDefinition,
  assertCacheKey,
  assertEnvironment,
  audit,
  cacheKeyDigest,
  compatibleSchema,
  conflict,
  decodeKey,
  definitionChecksum,
  knownSecrets,
  notFound,
  queryRecords,
  rejectSecretData,
  scopedCollection,
  validateDefinition,
  validateRecord,
} from "./storage-support.js";

export * from "./storage-support.js";

export const environmentTenantSchema = z
  .object({
    environmentId: z.string().uuid(),
    tenantId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._-]+$/),
  })
  .strict();
export const recordCreateSchema = environmentTenantSchema.extend({
  data: z.record(z.unknown()),
});
export const recordUpdateSchema = recordCreateSchema.extend({
  revision: z.number().int().positive(),
});
export const recordDeleteSchema = environmentTenantSchema.extend({
  revision: z.number().int().positive(),
});
export const recordQuerySchema = environmentTenantSchema.extend(
  collectionQuerySchema.shape,
);
export const collectionGrantInputSchema = z
  .object({
    functionId: z.string().uuid(),
    permissions: collectionPermissionsSchema,
  })
  .strict();
export const cacheListSchema = z
  .object({
    environmentId: z.string().uuid(),
    cursor: z.string().regex(/^\d+$/).default("0"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    functionId: z.string().uuid().optional(),
    tenantId: z.string().max(128).optional(),
    prefix: z.string().max(256).optional(),
  })
  .strict();
export const cacheTokenSchema = z
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
    const input = parse(collectionGrantInputSchema, request.body);
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
