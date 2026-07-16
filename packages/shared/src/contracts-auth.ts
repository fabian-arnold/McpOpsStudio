import { z } from "zod";

export const secretCreateSchema = z.object({
  environmentId: z.string().uuid(),
  name: z.string().regex(/^[A-Z][A-Z0-9_]{1,99}$/),
  value: z.string().min(1).max(16_384),
});
export const secretRotateSchema = z
  .object({ value: z.string().min(1).max(16_384) })
  .strict();
const staticCredentialBase = z
  .object({
    header: z.string().regex(/^[a-z0-9-]{1,64}$/),
    secretRef: z.string().regex(/^[A-Z][A-Z0-9_]{1,99}$/),
    permissions: z.array(z.string().min(1).max(256)).default([]),
  })
  .strict();
const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "URL must use HTTPS");
const bearerHeader = {
  header: z.literal("authorization").default("authorization"),
  scheme: z.literal("Bearer").default("Bearer"),
};
export const jwtPolicyConfigSchema = z
  .object({
    ...bearerHeader,
    issuer: httpsUrl,
    audience: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    jwksUrl: httpsUrl,
    requiredClaims: z
      .record(z.array(z.union([z.string(), z.number(), z.boolean()])).min(1))
      .default({}),
    clockSkewSeconds: z.number().int().min(0).max(300).default(60),
  })
  .strict();
export const entraPolicyConfigSchema = z
  .object({
    ...bearerHeader,
    tenantMode: z.enum(["single_tenant", "multi_tenant"]),
    tenantId: z.string().min(1),
    audience: z.string().min(1),
    jwksUrl: httpsUrl.optional(),
    allowedTenantIds: z.array(z.string().uuid()).default([]),
    clockSkewSeconds: z.number().int().min(0).max(300).default(60),
  })
  .strict()
  .superRefine((config, context) => {
    if (
      config.tenantMode === "single_tenant" &&
      !z.string().uuid().safeParse(config.tenantId).success
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tenantId"],
        message: "Single-tenant Entra policies require a tenant UUID",
      });
    if (
      config.tenantMode === "multi_tenant" &&
      !["common", "projects"].includes(config.tenantId) &&
      !z.string().uuid().safeParse(config.tenantId).success
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tenantId"],
        message:
          "Multi-tenant Entra tenantId must be common, projects, or a tenant UUID",
      });
  });
export const webhookSignaturePolicyConfigSchema = z
  .object({
    algorithm: z.literal("hmac-sha256").default("hmac-sha256"),
    header: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/)
      .default("x-mcpops-signature"),
    timestampHeader: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/)
      .default("x-mcpops-timestamp"),
    signaturePrefix: z.literal("sha256=").default("sha256="),
    secretRef: z.string().regex(/^[A-Z][A-Z0-9_]{1,99}$/),
    toleranceSeconds: z.number().int().min(30).max(900).default(300),
    replayProtection: z.literal(true).default(true),
    permissions: z.array(z.string().min(1).max(256)).default([]),
  })
  .strict();
export const customFunctionPolicyConfigSchema = z
  .object({ functionId: z.string().uuid() })
  .strict();
export const customAuthInputSchema = z
  .object({
    request: z
      .object({
        method: z.string().min(1).max(32),
        path: z.string().min(1).max(4_096),
        headers: z.record(z.union([z.string(), z.array(z.string())])),
        query: z.record(z.union([z.string(), z.array(z.string())])),
        body: z.unknown().optional(),
      })
      .strict(),
    endpoint: z
      .object({
        id: z.string().min(1),
        kind: z.enum(["mcp", "http"]),
        slug: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export const customAuthResultSchema = z
  .object({
    authenticated: z.boolean(),
    subject: z.string().min(1).max(256).optional(),
    name: z.string().min(1).max(256).optional(),
    email: z.string().email().max(320).optional(),
    permissions: z.array(z.string().min(1).max(256)).max(256).default([]),
  })
  .strict()
  .refine((result) => !result.authenticated || Boolean(result.subject), {
    message: "An authenticated result requires a subject",
    path: ["subject"],
  });
export const authPolicyMutationSchema = z.discriminatedUnion("type", [
  z
    .object({
      name: z.string().min(2).max(120),
      type: z.literal("public"),
      config: z
        .object({
          permissions: z.array(z.string().min(1).max(256)).default([]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      name: z.string().min(2).max(120),
      type: z.literal("api_key"),
      config: staticCredentialBase.extend({
        header: z
          .string()
          .regex(/^[a-z0-9-]{1,64}$/)
          .default("x-api-key"),
      }),
    })
    .strict(),
  z
    .object({
      name: z.string().min(2).max(120),
      type: z.literal("bearer_token"),
      config: staticCredentialBase.extend({
        header: z.literal("authorization").default("authorization"),
        scheme: z.literal("Bearer").default("Bearer"),
      }),
    })
    .strict(),
  z
    .object({
      name: z.string().min(2).max(120),
      type: z.literal("basic_auth"),
      config: staticCredentialBase.extend({
        header: z.literal("authorization").default("authorization"),
        scheme: z.literal("Basic").default("Basic"),
        username: z
          .string()
          .min(1)
          .max(256)
          .regex(/^[^\s:][^:]*$/),
      }),
    })
    .strict(),
  z
    .object({
      name: z.string().min(2).max(120),
      type: z.literal("jwt"),
      config: jwtPolicyConfigSchema,
    })
    .strict(),
  z
    .object({
      name: z.string().min(2).max(120),
      type: z.literal("entra_id"),
      config: entraPolicyConfigSchema,
    })
    .strict(),
  z
    .object({
      name: z.string().min(2).max(120),
      type: z.literal("webhook_signature"),
      config: webhookSignaturePolicyConfigSchema,
    })
    .strict(),
  z
    .object({
      name: z.string().min(2).max(120),
      type: z.literal("custom_function"),
      config: customFunctionPolicyConfigSchema,
    })
    .strict(),
]);
export const authPolicySchema = z.object({
  name: z.string().min(2),
  type: z.enum([
    "public",
    "api_key",
    "bearer_token",
    "basic_auth",
    "jwt",
    "oidc",
    "entra_id",
    "webhook_signature",
    "custom_function",
  ]),
  config: z.record(z.unknown()),
});
