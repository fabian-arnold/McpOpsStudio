import { z } from "zod";
import {
  DEFAULT_FUNCTION_TIMEOUT_MS,
  MAX_FUNCTION_TIMEOUT_MS,
  MIN_FUNCTION_TIMEOUT_MS,
} from "./limits.js";

export const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const functionSlugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
export const jsonSchemaSchema = z
  .record(z.unknown())
  .refine(
    (value) => value.type !== undefined || Object.keys(value).length === 0,
    "Schema must declare type or be empty to allow any value",
  );
export const riskLevelSchema = z.enum(["read", "write", "destructive"]);
export const roleSchema = z.enum(["owner", "admin", "developer", "operator", "viewer"]);

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export const installationSetupSchema = z
  .object({
    setupCode: z.string().min(16).max(256),
    ownerEmail: z.string().email(),
    ownerPassword: z.string().min(12).max(256),
    projectName: z.string().trim().min(2).max(120),
    projectSlug: slugSchema,
    publicUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        const local = ["localhost", "127.0.0.1", "::1"].includes(
          url.hostname.toLowerCase(),
        );
        return url.protocol === "https:" || (local && url.protocol === "http:");
      }, "Public URL must use HTTPS (HTTP is allowed only for localhost)"),
    starter: z.enum(["clean", "notes-demo"]),
  })
  .strict();
export const projectCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: slugSchema,
    description: z.string().trim().max(2000).default(""),
  })
  .strict();
export const projectUpdateSchema = projectCreateSchema.partial().strict();
export const runtimeLogLevelSchema = z.enum(["debug", "info", "warn", "error", "off"]);
export const runtimeLogSettingsSchema = z
  .object({
    level: runtimeLogLevelSchema,
    retentionDays: z.number().int().min(1).max(3650),
    retentionMaxEntries: z.number().int().min(100).max(10_000_000),
    retentionMaxBytes: z.number().int().min(1_048_576).max(2_000_000_000),
  })
  .strict();
export const projectSettingsUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    slug: slugSchema.optional(),
    description: z.string().trim().max(2000).optional(),
    captureDevelopmentPayloads: z.boolean().optional(),
    logging: z
      .object({
        development: runtimeLogSettingsSchema.optional(),
        production: runtimeLogSettingsSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one Project setting is required",
  });
export const projectDeleteSchema = z.object({ confirmation: slugSchema }).strict();
export const userCreateSchema = z
  .object({
    email: z.string().email(),
    temporaryPassword: z.string().min(12).max(256),
    role: roleSchema,
  })
  .strict();
export const userUpdateSchema = z
  .object({ role: roleSchema.optional(), active: z.boolean().optional() })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one user field is required",
  );
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(12).max(256),
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ["newPassword"],
    message: "New password must be different",
  });
export const endpointCreateSchema = z
  .object({
    kind: z.enum(["mcp", "http"]),
    name: z.string().min(2).max(120),
    slug: slugSchema,
    description: z.string().max(2000).default(""),
  })
  .strict();
export const endpointListQuerySchema = z
  .object({
    environmentId: z.string().uuid().optional(),
    kind: z.enum(["mcp", "http"]).optional(),
    status: z.enum(["draft", "deployed", "disabled", "failed"]).optional(),
    q: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export const endpointStatusSchema = z
  .object({ status: z.enum(["enabled", "disabled"]) })
  .strict();
export const globalSearchQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(120),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export const functionCreateSchema = z
  .object({
    name: z.string().min(2).max(120),
    slug: functionSlugSchema,
    description: z.string().max(4000).default(""),
    code: z.string().min(1).max(200_000),
    inputSchema: jsonSchemaSchema,
    outputSchema: jsonSchemaSchema,
    timeoutMs: z
      .number()
      .int()
      .min(MIN_FUNCTION_TIMEOUT_MS)
      .max(MAX_FUNCTION_TIMEOUT_MS)
      .default(DEFAULT_FUNCTION_TIMEOUT_MS),
    enabled: z.boolean().default(true),
    riskLevel: riskLevelSchema.default("read"),
    requiredPermissions: z.array(z.string()).default([]),
    secretGrantIds: z.array(z.string().uuid()).default([]),
    cachePolicy: z
      .object({
        ttlSeconds: z.number().int().min(1).max(86_400).optional(),
        defaultTtlSeconds: z.number().int().min(1).max(86_400).optional(),
        maxTtlSeconds: z.number().int().min(1).max(86_400).default(86_400),
      })
      .strict()
      .refine(
        (policy) =>
          (policy.defaultTtlSeconds ?? policy.ttlSeconds ?? 300) <=
          policy.maxTtlSeconds,
        "Default cache TTL cannot exceed maximum cache TTL",
      )
      .nullable()
      .default(null),
  })
  .strict();
export const functionUpdateSchema = functionCreateSchema.partial();
export const mcpBindingSchema = z.object({
  functionId: z.string().uuid(),
  toolName: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  title: z.string().min(1).max(120),
  description: z.string().max(2000),
  enabled: z.boolean().default(true),
});
const responsePathSchema = z.string().trim().min(1).max(512);
const responseFieldsSchema = z.record(responsePathSchema);
export const responseMappingSchema = z.union([
  z
    .object({
      statusCode: z.number().int().min(100).max(599).optional(),
      headers: responseFieldsSchema.optional(),
      body: z.union([responsePathSchema, responseFieldsSchema]).optional(),
    })
    .strict(),
  responseFieldsSchema.refine(
    (mapping) =>
      !Object.keys(mapping).some((key) =>
        ["statusCode", "headers", "body"].includes(key),
      ),
    "Reserved response mapping keys require structured mapping syntax",
  ),
]);
export const httpBindingSchema = z.object({
  functionId: z.string().uuid(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z
    .string()
    .startsWith("/")
    .regex(/^\/[A-Za-z0-9_\-/:]*$/),
  inputMapping: z.record(z.unknown()).nullable().optional(),
  responseMapping: responseMappingSchema.nullable().optional(),
  enabled: z.boolean().default(true),
});
