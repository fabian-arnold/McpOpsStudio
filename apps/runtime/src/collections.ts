import { Ajv } from "ajv";
import { Prisma, prisma } from "@mcpops/db";
import {
  collectionQuerySchema,
  collectionWhereSchema,
  type CollectionQuery as SharedCollectionQuery,
  type CollectionWhere as SharedCollectionWhere,
} from "@mcpops/shared";
import {
  SafeRuntimeError,
  type CollectionQuery,
  type CollectionRecord,
  type CollectionWhere,
  type ProjectCollections,
  type ScopedCollection,
} from "@mcpops/runtime-sdk";
import type { CollectionGrantSnapshot, LoadedEndpoint } from "./domain.js";

type Row = {
  id: string;
  data: unknown;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};
type Cursor = { values: unknown[]; id: string };

export class SnapshotCollections implements ProjectCollections {
  constructor(
    private readonly endpoint: LoadedEndpoint,
    private readonly functionId: string,
    private readonly tenantId: string | undefined,
    private readonly requestId: string,
    private readonly knownSecrets: readonly string[] = [],
  ) {}

  collection<T = Record<string, unknown>>(slug: string): ScopedCollection<T> {
    const grant = this.endpoint.snapshot.collections.find(
      (candidate) =>
        candidate.functionId === this.functionId && candidate.slug === slug,
    );
    if (!grant)
      throw this.error(
        "FORBIDDEN",
        `Collection '${slug}' is not granted to this Function.`,
      );
    if (!this.tenantId)
      throw this.error(
        "CONFIGURATION_ERROR",
        "Collection access requires an authenticated tenant identity.",
      );
    return new DatabaseCollection<T>(
      this.endpoint,
      grant,
      this.tenantId,
      this.requestId,
      this.knownSecrets,
    );
  }

  private error(code: "FORBIDDEN" | "CONFIGURATION_ERROR", message: string) {
    return new SafeRuntimeError({ code, message, requestId: this.requestId });
  }
}

class DatabaseCollection<T> implements ScopedCollection<T> {
  private readonly validate: ReturnType<Ajv["compile"]>;

  constructor(
    private readonly endpoint: LoadedEndpoint,
    private readonly grant: CollectionGrantSnapshot,
    private readonly tenantId: string,
    private readonly requestId: string,
    private readonly knownSecrets: readonly string[],
  ) {
    this.validate = new Ajv({ allErrors: true, strict: false }).compile(grant.schema);
  }

  async create(data: T): Promise<CollectionRecord<T>> {
    this.require("write");
    this.validateData(data);
    const row = await prisma.collectionRecord.create({
      data: {
        projectId: this.endpoint.project.id,
        environmentId: this.endpoint.environment.id,
        collectionId: this.grant.collectionId,
        schemaVersionId: this.grant.schemaVersionId,
        tenantScope: this.tenantId,
        data: data as Prisma.InputJsonValue,
      },
    });
    return view(row) as CollectionRecord<T>;
  }

  async get(
    id: string,
    options?: { select?: string[] },
  ): Promise<CollectionRecord<T> | null> {
    this.require("read");
    const row = await prisma.collectionRecord.findFirst({
      where: { ...this.scope(), id },
    });
    return row ? (project(view(row), options?.select) as CollectionRecord<T>) : null;
  }

  async query(query: CollectionQuery = {}): Promise<{
    items: Array<CollectionRecord<Partial<T>>>;
    nextCursor?: string;
  }> {
    this.require("read");
    const parsed = collectionQuerySchema.parse(query as SharedCollectionQuery);
    const order = parsed.orderBy.length
      ? parsed.orderBy
      : [{ field: "createdAt" as const, direction: "asc" as const }];
    const cursor = parsed.cursor ? decodeCursor(parsed.cursor) : undefined;
    const where = [
      Prisma.sql`"projectId" = ${this.endpoint.project.id}::uuid`,
      Prisma.sql`"environmentId" = ${this.endpoint.environment.id}::uuid`,
      Prisma.sql`"collectionId" = ${this.grant.collectionId}::uuid`,
      Prisma.sql`"tenantScope" = ${this.tenantId}`,
      ...(parsed.where ? [compileWhere(parsed.where, this.grant.schema)] : []),
      ...(cursor ? [compileCursor(order, cursor, this.grant.schema)] : []),
    ];
    const ordering = [
      ...order.map(
        (item) =>
          Prisma.sql`${fieldExpression(item.field, this.grant.schema)} ${Prisma.raw(`${item.direction.toUpperCase()} NULLS LAST`)}`,
      ),
      Prisma.sql`"id" ASC`,
    ];
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('statement_timeout', '5000', true)`;
      return tx.$queryRaw<Row[]>(Prisma.sql`
        SELECT "id", "data", "revision", "createdAt", "updatedAt"
        FROM "collection_records"
        WHERE ${Prisma.join(where, " AND ")}
        ORDER BY ${Prisma.join(ordering, ", ")}
        LIMIT ${parsed.limit + 1}
      `);
    });
    const hasMore = rows.length > parsed.limit;
    const page = rows.slice(0, parsed.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => project(view(row), parsed.select)) as Array<
        CollectionRecord<Partial<T>>
      >,
      ...(hasMore && last
        ? {
            nextCursor: encodeCursor({
              values: order.map((item) => fieldValue(last, item.field)),
              id: last.id,
            }),
          }
        : {}),
    };
  }

  async count(options: { where?: CollectionWhere } = {}): Promise<number> {
    this.require("read");
    const where = options.where
      ? collectionWhereSchema.parse(options.where as SharedCollectionWhere)
      : undefined;
    const clauses = [
      Prisma.sql`"projectId" = ${this.endpoint.project.id}::uuid`,
      Prisma.sql`"environmentId" = ${this.endpoint.environment.id}::uuid`,
      Prisma.sql`"collectionId" = ${this.grant.collectionId}::uuid`,
      Prisma.sql`"tenantScope" = ${this.tenantId}`,
      ...(where ? [compileWhere(where, this.grant.schema)] : []),
    ];
    const [result] = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('statement_timeout', '5000', true)`;
      return tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS "count" FROM "collection_records"
        WHERE ${Prisma.join(clauses, " AND ")}
      `);
    });
    return Number(result?.count ?? 0);
  }

  async update(
    id: string,
    data: T,
    options: { revision: number },
  ): Promise<CollectionRecord<T>> {
    this.require("write");
    this.validateData(data);
    const result = await prisma.collectionRecord.updateMany({
      where: { ...this.scope(), id, revision: options.revision },
      data: {
        data: data as Prisma.InputJsonValue,
        schemaVersionId: this.grant.schemaVersionId,
        revision: { increment: 1 },
      },
    });
    if (result.count !== 1) throw this.conflict();
    const row = await prisma.collectionRecord.findUniqueOrThrow({ where: { id } });
    return view(row) as CollectionRecord<T>;
  }

  async delete(id: string, options: { revision: number }): Promise<void> {
    this.require("delete");
    const result = await prisma.collectionRecord.deleteMany({
      where: { ...this.scope(), id, revision: options.revision },
    });
    if (result.count !== 1) throw this.conflict();
  }

  private scope() {
    return {
      projectId: this.endpoint.project.id,
      environmentId: this.endpoint.environment.id,
      collectionId: this.grant.collectionId,
      tenantScope: this.tenantId,
    };
  }
  private require(permission: "read" | "write" | "delete") {
    if (!this.grant.permissions.includes(permission))
      throw new SafeRuntimeError({
        code: "FORBIDDEN",
        message: `Collection permission '${permission}' is required.`,
        requestId: this.requestId,
      });
  }
  private validateData(data: unknown) {
    if (containsSecret(data, this.knownSecrets))
      throw new SafeRuntimeError({
        code: "VALIDATION_ERROR",
        message: "Platform secret values cannot be persisted in a data collection.",
        requestId: this.requestId,
      });
    if (!this.validate(data))
      throw new SafeRuntimeError({
        code: "VALIDATION_ERROR",
        message: "Collection record does not match its deployed schema.",
        requestId: this.requestId,
      });
  }
  private conflict() {
    return new SafeRuntimeError({
      code: "VALIDATION_ERROR",
      message: "Collection record was changed or deleted by another operation.",
      requestId: this.requestId,
    });
  }
}

export function compileWhere(
  where: SharedCollectionWhere,
  schema: Record<string, unknown>,
): Prisma.Sql {
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
  return compileComparison(where, schema);
}

type CollectionComparison = Extract<SharedCollectionWhere, { field: string }>;

function compileComparison(
  where: CollectionComparison,
  schema: Record<string, unknown>,
): Prisma.Sql {
  assertField(where.field, schema);
  const json = jsonExpression(where.field);
  const text = textExpression(where.field);
  switch (where.op) {
    case "eq":
      return Prisma.sql`${json} = ${JSON.stringify(where.value)}::jsonb`;
    case "ne":
      return Prisma.sql`${json} IS DISTINCT FROM ${JSON.stringify(where.value)}::jsonb`;
    case "in":
    case "notIn": {
      if (!Array.isArray(where.value) || where.value.length === 0)
        throw new Error(`${where.op} requires a non-empty array`);
      const expression = Prisma.sql`(${Prisma.join(
        where.value.map(
          (value) => Prisma.sql`${json} = ${JSON.stringify(value)}::jsonb`,
        ),
        " OR ",
      )})`;
      return where.op === "notIn" ? Prisma.sql`NOT ${expression}` : expression;
    }
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const operator = { lt: "<", lte: "<=", gt: ">", gte: ">=" }[where.op];
      return Prisma.sql`${sortableExpression(where.field, schema)} ${Prisma.raw(operator)} ${where.value}`;
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

function compileCursor(
  order: SharedCollectionQuery["orderBy"],
  cursor: Cursor,
  schema: Record<string, unknown>,
): Prisma.Sql {
  if (cursor.values.length !== order.length)
    throw new Error("Invalid collection cursor");
  const branches: Prisma.Sql[] = [];
  for (let index = 0; index <= order.length; index += 1) {
    const equal = order
      .slice(0, index)
      .map(
        (item, position) =>
          Prisma.sql`${fieldExpression(item.field, schema)} IS NOT DISTINCT FROM ${cursorValue(item.field, cursor.values[position], schema)}`,
      );
    if (index === order.length) {
      branches.push(
        Prisma.sql`(${Prisma.join([...equal, Prisma.sql`"id" > ${cursor.id}::uuid`], " AND ")})`,
      );
      break;
    }
    const item = order[index]!;
    const operator = item.direction === "desc" ? "<" : ">";
    const expression = fieldExpression(item.field, schema);
    const comparison =
      cursor.values[index] === null
        ? Prisma.sql`FALSE`
        : Prisma.sql`(${expression} ${Prisma.raw(operator)} ${cursorValue(item.field, cursor.values[index], schema)} OR ${expression} IS NULL)`;
    branches.push(Prisma.sql`(${Prisma.join([...equal, comparison], " AND ")})`);
  }
  return Prisma.sql`(${Prisma.join(branches, " OR ")})`;
}
function cursorValue(field: string, value: unknown, schema: Record<string, unknown>) {
  if (field === "id") return Prisma.sql`${value}::uuid`;
  if (field === "createdAt" || field === "updatedAt")
    return Prisma.sql`${value}::timestamptz`;
  const type = fieldSchema(field, schema).type;
  if (type === "number" || type === "integer") return Prisma.sql`${value}::numeric`;
  if (type === "boolean") return Prisma.sql`${value}::boolean`;
  return Prisma.sql`${value}::text`;
}

function fieldExpression(field: string, schema: Record<string, unknown>): Prisma.Sql {
  if (field === "id") return Prisma.sql`"id"`;
  if (field === "createdAt") return Prisma.sql`"createdAt"`;
  if (field === "updatedAt") return Prisma.sql`"updatedAt"`;
  return sortableExpression(field, schema);
}
function sortableExpression(
  field: string,
  schema: Record<string, unknown>,
): Prisma.Sql {
  assertField(field, schema);
  const type = fieldSchema(field, schema).type;
  const text = textExpression(field);
  if (type === "number" || type === "integer")
    return Prisma.sql`NULLIF(${text}, '')::numeric`;
  if (type === "boolean") return Prisma.sql`NULLIF(${text}, '')::boolean`;
  return text;
}
function jsonExpression(field: string) {
  return Prisma.sql`"data" #> ${field.split(".")}::text[]`;
}
function textExpression(field: string) {
  return Prisma.sql`"data" #>> ${field.split(".")}::text[]`;
}
function fieldSchema(
  field: string,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  let current = schema;
  for (const part of field.split(".")) {
    const properties = current.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties))
      throw new Error(`Unknown collection field '${field}'`);
    const next = (properties as Record<string, unknown>)[part];
    if (!next || typeof next !== "object" || Array.isArray(next))
      throw new Error(`Unknown collection field '${field}'`);
    current = next as Record<string, unknown>;
  }
  return current;
}
function assertField(field: string, schema: Record<string, unknown>) {
  fieldSchema(field, schema);
}
function fieldValue(row: Row, field: string): unknown {
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
function view(row: Row): CollectionRecord {
  return {
    id: row.id,
    data: row.data as Record<string, unknown>,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function project(record: CollectionRecord, select?: string[]): CollectionRecord {
  if (!select?.length) return record;
  const data: Record<string, unknown> = {};
  for (const field of select) data[field] = fieldValue(recordRow(record), field);
  return { ...record, data };
}
function recordRow(record: CollectionRecord): Row {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}
function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
function decodeCursor(cursor: string): Cursor {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Cursor;
    if (!Array.isArray(value.values) || typeof value.id !== "string") throw new Error();
    return value;
  } catch {
    throw new Error("Invalid collection cursor");
  }
}
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
function containsSecret(value: unknown, secrets: readonly string[]): boolean {
  if (typeof value === "string")
    return secrets.some((secret) => secret.length >= 4 && value.includes(secret));
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((item) => containsSecret(item, secrets));
}
