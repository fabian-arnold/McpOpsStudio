import { createHash } from "node:crypto";
import { Ajv } from "ajv";
import { Prisma, decryptSecret, prisma } from "@mcpops/db";
import {
  canonicalJson,
  collectionFieldPathSchema,
  type CollectionQuery,
  type CollectionWhere,
} from "@mcpops/shared";
import { z } from "zod";
import type { sessionContext } from "./helpers.js";

export async function queryRecords(
  projectId: string,
  environmentId: string,
  collectionId: string,
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

export function validateDefinition(
  schema: Record<string, unknown>,
  indexes: Array<{ fields: string[] }>,
) {
  new Ajv({ allErrors: true, strict: false }).compile(schema);
  for (const index of indexes)
    for (const field of index.fields) fieldDefinition(schema, field);
}
export function validateRecord(schema: unknown, data: unknown) {
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
export function compatibleSchema(previous: unknown, next: unknown): boolean {
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
export function definitionChecksum(schema: unknown, indexes: unknown): string {
  return createHash("sha256").update(canonicalJson({ schema, indexes })).digest("hex");
}
export function cacheKeyDigest(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
export async function scopedCollection(projectId: string, id: string) {
  const collection = await prisma.dataCollection.findFirst({
    where: { id, projectId },
  });
  if (!collection) throw notFound("Data collection not found");
  return collection;
}
export async function activeDefinition(
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
export async function assertEnvironment(projectId: string, environmentId: string) {
  const found = await prisma.environment.findFirst({
    where: { id: environmentId, projectId },
  });
  if (!found) throw notFound("Environment not found");
}
export async function audit(
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
export async function knownSecrets(
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
export function decodeKey(value: string): string {
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
export function assertCacheKey(key: string, projectId: string, environmentId: string) {
  if (!key.startsWith(`mcpops:${projectId}:${environmentId}:`))
    throw Object.assign(new Error("Cache key is outside the selected scope"), {
      statusCode: 403,
      code: "FORBIDDEN",
    });
}
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}
export function notFound(message: string) {
  return Object.assign(new Error(message), { statusCode: 404, code: "NOT_FOUND" });
}
export function conflict() {
  return Object.assign(
    new Error("Record was changed or deleted by another operation"),
    { statusCode: 409, code: "REVISION_CONFLICT" },
  );
}
export function rejectSecretData(value: unknown, secrets: readonly string[]): void {
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
