import { z } from "zod";

export const collectionSlugSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z][a-z0-9_]*$/);
export const collectionFieldPathSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/);

export const collectionIndexSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z][a-z0-9_]*$/),
    kind: z.enum(["btree", "gin"]).default("btree"),
    fields: z.array(collectionFieldPathSchema).min(1).max(4),
    unique: z.boolean().default(false),
  })
  .strict()
  .superRefine((index, context) => {
    if (index.kind === "gin" && (index.fields.length !== 1 || index.unique))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GIN indexes require exactly one field and cannot be unique",
      });
  });

export const collectionDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: collectionSlugSchema,
    description: z.string().max(2_000).default(""),
    schema: z
      .record(z.unknown())
      .refine(
        (value) => value.type === "object",
        "Collection schema must have type object",
      ),
    indexes: z.array(collectionIndexSchema).max(20).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.indexes.map((index) => index.name)).size !== value.indexes.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["indexes"],
        message: "Collection index names must be unique",
      });
  });

export const collectionPermissionsSchema = z
  .array(z.enum(["read", "write", "delete"]))
  .min(1)
  .transform((permissions) => [...new Set(permissions)]);

export const collectionPredicateSchema = z
  .object({
    field: collectionFieldPathSchema,
    op: z.enum([
      "eq",
      "ne",
      "in",
      "notIn",
      "lt",
      "lte",
      "gt",
      "gte",
      "isNull",
      "contains",
      "startsWith",
      "endsWith",
      "arrayContains",
    ]),
    value: z.unknown().optional(),
  })
  .strict();

export type CollectionWhere =
  | z.infer<typeof collectionPredicateSchema>
  | { and: CollectionWhere[] }
  | { or: CollectionWhere[] }
  | { not: CollectionWhere };

export const collectionWhereSchema: z.ZodType<CollectionWhere> = z.lazy(() =>
  z.union([
    collectionPredicateSchema,
    z.object({ and: z.array(collectionWhereSchema).min(1).max(20) }).strict(),
    z.object({ or: z.array(collectionWhereSchema).min(1).max(20) }).strict(),
    z.object({ not: collectionWhereSchema }).strict(),
  ]),
);

export const collectionQuerySchema = z
  .object({
    where: collectionWhereSchema.optional(),
    orderBy: z
      .array(
        z
          .object({
            field: z.union([
              collectionFieldPathSchema,
              z.enum(["createdAt", "updatedAt", "id"]),
            ]),
            direction: z.enum(["asc", "desc"]).default("asc"),
          })
          .strict(),
      )
      .max(3)
      .default([]),
    select: z.array(collectionFieldPathSchema).max(50).optional(),
    limit: z.number().int().min(1).max(500).default(100),
    cursor: z.string().max(4_096).optional(),
  })
  .strict();

export type CollectionQuery = z.infer<typeof collectionQuerySchema>;
export type CollectionIndex = z.infer<typeof collectionIndexSchema>;
