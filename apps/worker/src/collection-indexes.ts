import { createHash } from "node:crypto";
import { Prisma, prisma } from "@mcpops/db";
import { collectionIndexSchema } from "@mcpops/shared";

type CollectionSnapshot = {
  collectionId: string;
  schema: Record<string, unknown>;
  indexes: unknown;
};

/** Reconciles only indexes requested by the candidate snapshot. Obsolete indexes
 * remain usable by older active snapshots and can be cleaned up separately. */
export async function ensureCollectionIndexes(
  collections: CollectionSnapshot[],
): Promise<void> {
  const unique = new Map(collections.map((item) => [item.collectionId, item]));
  for (const collection of unique.values()) {
    const indexes = collectionIndexSchema.array().parse(collection.indexes);
    for (const index of indexes) {
      const suffix = createHash("sha256")
        .update(`${collection.collectionId}:${index.name}:${JSON.stringify(index)}`)
        .digest("hex")
        .slice(0, 16);
      const name = `mcpops_dc_${collection.collectionId.replaceAll("-", "").slice(0, 8)}_${suffix}`;
      const predicate = `WHERE "collectionId" = '${collection.collectionId}'::uuid`;
      const uniqueSql = index.unique ? "UNIQUE " : "";
      const expression =
        index.kind === "gin"
          ? `${jsonExpression(index.fields[0]!)}`
          : [
              '"environmentId"',
              '"tenantScope"',
              ...index.fields.map((field) =>
                sortableExpression(field, collection.schema),
              ),
            ].join(", ");
      const using = index.kind === "gin" ? " USING GIN" : "";
      await prisma.$executeRaw(
        Prisma.raw(
          `CREATE ${uniqueSql}INDEX IF NOT EXISTS "${name}" ON "collection_records"${using} (${expression}) ${predicate}`,
        ),
      );
    }
  }
}

function sortableExpression(field: string, schema: Record<string, unknown>): string {
  const definition = fieldDefinition(field, schema);
  const expression = textExpression(field);
  if (definition.type === "number" || definition.type === "integer")
    return `(NULLIF(${expression}, '')::numeric)`;
  if (definition.type === "boolean") return `(NULLIF(${expression}, '')::boolean)`;
  return `(${expression})`;
}
function textExpression(field: string): string {
  return `"data" #>> '${path(field)}'`;
}
function jsonExpression(field: string): string {
  return `("data" #> '${path(field)}')`;
}
function path(field: string): string {
  const parts = field.split(".");
  if (!parts.every((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part)))
    throw new Error(`Invalid collection index field: ${field}`);
  return `{${parts.join(",")}}`;
}
function fieldDefinition(field: string, schema: Record<string, unknown>) {
  let current = schema;
  for (const part of field.split(".")) {
    const properties = current.properties as Record<string, unknown> | undefined;
    const next = properties?.[part];
    if (!next || typeof next !== "object" || Array.isArray(next))
      throw new Error(`Unknown collection index field: ${field}`);
    current = next as Record<string, unknown>;
  }
  return current;
}
