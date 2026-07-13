import { z } from "zod";
import { validateReviewedReadQuery } from "@mcpops/shared";

const jsonSchema = z.record(z.unknown());
export const cachePolicySchema = z
  .object({
    defaultTtlSeconds: z.number().int().min(1).max(86_400).optional(),
    ttlSeconds: z.number().int().min(1).max(86_400).optional(),
    maxTtlSeconds: z.number().int().min(1).max(86_400).default(86_400),
  })
  .strict()
  .refine(
    (policy) =>
      (policy.defaultTtlSeconds ?? policy.ttlSeconds ?? 300) <=
      policy.maxTtlSeconds,
    "Default cache TTL cannot exceed maximum cache TTL",
  );
export const endpointAccessPolicySchema = z
  .object({
    mode: z.enum(["authenticated", "restricted"]).default("authenticated"),
    allowedSubjects: z.array(z.string().min(1).max(256)).default([]),
  })
  .refine(
    (policy) =>
      policy.mode !== "restricted" || policy.allowedSubjects.length > 0,
    "Restricted endpoint access requires at least one subject rule",
  );
export const snapshotFunctionSchema = z.object({
  id: z.string().optional(),
  functionId: z.string(),
  versionId: z.string(),
  version: z.number().int().positive(),
  name: z.string(),
  slug: z.string().optional(),
  enabled: z.boolean().default(true),
  riskLevel: z.enum(["read", "write", "destructive"]),
  requiredPermissions: z.array(z.string()).default([]),
  secretGrants: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().max(120_000),
  inputSchema: jsonSchema,
  outputSchema: jsonSchema.optional(),
  cachePolicy: cachePolicySchema.nullable().default(null),
  compiledCode: z.string(),
});
export const mcpBindingSchema = z.object({
  id: z.string(),
  functionId: z.string(),
  toolName: z.string(),
  title: z.string().optional(),
  description: z.string(),
  enabled: z.boolean().default(true),
});
export const httpBindingSchema = z.object({
  id: z.string(),
  functionId: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().startsWith("/"),
  inputMapping: z.record(z.unknown()).nullable().optional(),
  responseMapping: z.record(z.unknown()).nullable().optional(),
  enabled: z.boolean().default(true),
});
export const authPolicySchema = z.object({
  id: z.string(),
  type: z.enum([
    "public",
    "api_key",
    "bearer_token",
    "basic_auth",
    "jwt",
    "oidc",
    "entra_id",
    "webhook_signature",
  ]),
  config: z.record(z.unknown()),
});
export const reviewedQuerySnapshotSchema = z
  .object({
    grantId: z.string().min(1),
    functionId: z.string().min(1),
    queryDefinitionId: z.string().min(1),
    queryVersionId: z.string().min(1),
    queryId: z
      .string()
      .max(256)
      .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/),
    queryVersion: z.number().int().positive(),
    connection: z
      .object({
        id: z.string().min(1),
        name: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
        secretId: z.string().min(1),
      })
      .strict(),
    sql: z.string().min(1).max(100_000),
    parameterOrder: z
      .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/))
      .max(100),
    parameterSchema: jsonSchema.refine(
      (schema) => schema.type === "object",
      "Reviewed query parameter schema must have type: object",
    ),
    resultSchema: jsonSchema.optional(),
    timeoutMs: z.number().int().min(100).max(30_000),
    maxRows: z.number().int().min(1).max(10_000),
    maxBytes: z.number().int().min(1_024).max(10_485_760),
  })
  .strict()
  .superRefine((query, context) => {
    if (new Set(query.parameterOrder).size !== query.parameterOrder.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parameterOrder"],
        message: "Reviewed query parameter names must be unique",
      });
    try {
      validateReviewedReadQuery(query.sql, query.parameterOrder);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sql"],
        message:
          "Reviewed query SQL must be a safe read-only SELECT with exact positional parameters",
      });
    }
  });
export const deploymentSnapshotSchema = z
  .object({
    functions: z.array(snapshotFunctionSchema),
    functionCalls: z.array(z.object({
      callerFunctionId: z.string(),
      calleeFunctionId: z.string(),
      calleeSlug: z.string(),
    }).strict()).default([]),
    mcpBindings: z.array(mcpBindingSchema).default([]),
    httpBindings: z.array(httpBindingSchema).default([]),
    authPolicies: z.array(authPolicySchema).default([]),
    defaultAuthPolicyId: z.string().nullable().optional(),
    endpointAccessPolicy: endpointAccessPolicySchema.default({}),
    networkPolicy: z
      .object({
        allowedHosts: z.array(z.string()).default([]),
        allowedMethods: z.array(z.string()).default(["GET"]),
        allowedPorts: z.array(z.number().int()).default([443]),
        maxResponseBytes: z.number().int().positive().default(1_048_576),
        allowPrivateHosts: z.array(z.string()).default([]),
      })
      .default({}),
    env: z
      .record(
        z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
        z.string().max(8_192),
      )
      .default({}),
    libraries: z.array(z.record(z.unknown())).default([]),
    capabilities: z
      .object({
        reviewedDatabaseQueries: z
          .object({ enabled: z.boolean() })
          .strict()
          .default({ enabled: false }),
      })
      .passthrough()
      .default({ reviewedDatabaseQueries: { enabled: false } }),
    reviewedQueries: z.array(reviewedQuerySnapshotSchema).default([]),
  })
  .superRefine((snapshot, context) => {
    const grants = new Set<string>();
    for (const query of snapshot.reviewedQueries) {
      const key = `${query.functionId}\u0000${query.queryId}\u0000${query.connection.name}`;
      if (grants.has(key))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reviewedQueries"],
          message:
            "Reviewed query grants must be unique by function, query ID, and connection",
        });
      grants.add(key);
    }
  });
export type DeploymentSnapshot = z.infer<typeof deploymentSnapshotSchema>;
export type SnapshotFunction = z.infer<typeof snapshotFunctionSchema>;
export type McpBinding = z.infer<typeof mcpBindingSchema>;
export type HttpBinding = z.infer<typeof httpBindingSchema>;
export type AuthPolicy = z.infer<typeof authPolicySchema>;
export type EndpointAccessPolicy = z.infer<typeof endpointAccessPolicySchema>;
export type ReviewedQuerySnapshot = z.infer<typeof reviewedQuerySnapshotSchema>;

export type LoadedEndpoint = {
  id: string;
  name: string;
  slug: string;
  kind: "mcp" | "http";
  project: { id: string; name: string; slug: string };
  environment: {
    id: string;
    name: string;
    slug: string;
    capturePayloads?: boolean;
  };
  deployment: { id: string; version: number; checksum: string };
  snapshot: DeploymentSnapshot;
};
