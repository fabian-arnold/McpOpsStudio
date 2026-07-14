import { z } from "zod";

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
export const roleSchema = z.enum([
  "owner",
  "admin",
  "developer",
  "operator",
  "viewer",
]);

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
export const projectSettingsUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    slug: slugSchema.optional(),
    description: z.string().trim().max(2000).optional(),
    captureDevelopmentPayloads: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one Project setting is required",
  });
export const projectDeleteSchema = z
  .object({ confirmation: slugSchema })
  .strict();
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
    timeoutMs: z.number().int().min(100).max(120_000).default(30_000),
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
  ]),
  config: z.record(z.unknown()),
});
export const projectLibrarySchema = z
  .object({
    name: z.string().min(2).max(120),
    importPath: z.string().regex(/^@mcpops\/lib\/[a-z0-9]+(?:-[a-z0-9]+)*$/),
    description: z.string().max(2000).default(""),
    code: z.string().min(1).max(200_000),
    exportedFunctions: z
      .array(z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/))
      .max(100)
      .default([]),
  })
  .strict();
const networkHostSchema = z
  .string()
  .min(1)
  .max(253)
  .transform((host) => host.toLowerCase().replace(/\.$/, ""))
  .refine(
    (host) =>
      /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$|^(?:\d{1,3}\.){3}\d{1,3}$/.test(
        host,
      ),
    "Host must be a hostname, wildcard hostname, or IPv4 address",
  );
export const networkPolicyUpdateSchema = z
  .object({
    allowedHosts: z
      .array(networkHostSchema)
      .max(200)
      .transform((hosts) => [...new Set(hosts)]),
    allowedMethods: z
      .array(z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]))
      .transform((methods) => [...new Set(methods)]),
    allowedPorts: z
      .array(z.number().int().min(1).max(65_535))
      .max(50)
      .transform((ports) => [...new Set(ports)]),
    maxResponseBytes: z.number().int().min(1_024).max(10_485_760),
    allowPrivateHosts: z.array(networkHostSchema).max(50).default([]),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.allowedHosts.length > 0 && policy.allowedMethods.length === 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedMethods"],
        message: "At least one method is required when hosts are allowed",
      });
    if (policy.allowedHosts.length > 0 && policy.allowedPorts.length === 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedPorts"],
        message: "At least one port is required when hosts are allowed",
      });
    const hardBlocked = new Set([
      "169.254.169.254",
      "100.100.100.200",
      "metadata.google.internal",
      "metadata.azure.com",
    ]);
    for (const host of policy.allowPrivateHosts ?? []) {
      if (host.startsWith("*.") || !policy.allowedHosts.includes(host))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["allowPrivateHosts"],
          message: `Private host '${host}' must be an exact allowed host`,
        });
      if (hardBlocked.has(host))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["allowPrivateHosts"],
          message: `Metadata host '${host}' can never be allowed`,
        });
    }
  });
export const cachePurgeSchema = z
  .object({ confirmEndpointSlug: slugSchema })
  .strict();
export const testInvocationSchema = z.object({
  endpointId: z.string().uuid().optional(),
  input: z.unknown(),
  source: z.enum(["mcp", "http", "test"]).default("test"),
  caller: z
    .object({
      subject: z.string().optional(),
      permissions: z.array(z.string()).default([]),
      claims: z.record(z.unknown()).default({}),
    })
    .optional(),
});
export const rollbackSchema = z.object({ deploymentId: z.string().uuid() });
export const manifestImportSchema = z.object({
  format: z.enum(["yaml", "json"]),
  content: z.string().min(1),
  apply: z.boolean().default(false),
});

export const runtimeEnvironmentSchema = z
  .record(z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/), z.string().max(8_192))
  .superRefine((environment, context) => {
    for (const name of Object.keys(environment))
      if (/(?:^|_)(?:SECRET|TOKEN|PASSWORD|API_KEY)(?:_|$)/.test(name))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message:
            "Secret-like values must use Secret records and grants, not runtime env",
        });
  });
export const endpointAccessPolicySchema = z
  .object({
    mode: z.enum(["authenticated", "restricted"]).default("authenticated"),
    allowedSubjects: z.array(z.string().min(1).max(256)).default([]),
  })
  .superRefine((policy, context) => {
    if (policy.mode === "restricted" && policy.allowedSubjects.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Restricted endpoint access requires at least one rule",
      });
    }
  });
export const deploymentRuntimeConfigSchema = z
  .object({
    env: runtimeEnvironmentSchema.default({}),
    endpointAccessPolicy: endpointAccessPolicySchema.default({
      mode: "authenticated",
      allowedSubjects: [],
    }),
    network: z
      .object({
        allowPrivateHosts: z
          .array(z.string().regex(/^[a-z0-9.-]+$/i))
          .default([]),
      })
      .default({ allowPrivateHosts: [] }),
  })
  .strict();
export const deploymentCreateSchema = deploymentRuntimeConfigSchema.partial();
export const endpointSettingsUpdateSchema = z
  .object({
    name: z.string().min(2).max(120),
    slug: slugSchema,
    description: z.string().max(2000),
    runtimeVersion: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    runtime: z
      .object({
        timeoutMs: z.number().int().min(100).max(120_000),
        maxConcurrentRequests: z.number().int().min(1).max(500),
      })
      .strict(),
    env: runtimeEnvironmentSchema,
    endpointAccessPolicy: endpointAccessPolicySchema,
  })
  .strict();

export const endpointUrlsSchema = z.object({
  runtimeBaseUrl: z.string().url(),
  mcpUrl: z.string().url(),
  httpBaseUrl: z.string().url(),
});
const periodMetricSchema = z.object({
  current: z.number(),
  previous: z.number(),
  changePercent: z.number().nullable(),
});
export const executionComparisonsSchema = z.object({
  calls: periodMetricSchema,
  failures: periodMetricSchema,
  errorRate: periodMetricSchema,
  averageLatencyMs: periodMetricSchema,
  p95LatencyMs: periodMetricSchema,
});
export const dashboardResponseSchema = z
  .object({
    context: z.object({
      generatedAt: z.coerce.date(),
      window: z.literal("24h"),
      previousWindow: z.literal("preceding_24h"),
      bucketMinutes: z.literal(60),
    }),
    stats: z.object({
      endpoints: z.number().int().nonnegative(),
      calls24h: z.number().int().nonnegative(),
      failedCalls24h: z.number().int().nonnegative(),
      errorRate: z.number().nonnegative(),
      averageLatencyMs: z.number().nonnegative(),
      p95LatencyMs: z.number().nonnegative(),
      activeDeployments: z.number().int().nonnegative(),
    }),
    comparisons: executionComparisonsSchema,
    trafficBuckets: z
      .array(
        z.object({
          startedAt: z.coerce.date(),
          calls: z.number().int().nonnegative(),
          failures: z.number().int().nonnegative(),
        }),
      )
      .length(24),
    health: z.object({
      status: z.enum(["healthy", "degraded"]),
      database: z.literal("healthy"),
      redis: z.enum(["healthy", "unavailable"]),
      deployedEndpoints: z.number().int().nonnegative(),
      endpointsWithActiveSnapshot: z.number().int().nonnegative(),
      endpointsWithoutActiveSnapshot: z.number().int().nonnegative(),
      failedDeployments24h: z.number().int().nonnegative(),
    }),
    activeDeployments: z.array(
      z.object({
        id: z.string(),
        version: z.number().int(),
        checksum: z.string(),
        completedAt: z.coerce.date().nullable(),
        endpoint: z.object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
          kind: z.enum(["mcp", "http"]),
        }),
        endpoints: endpointUrlsSchema,
      }),
    ),
    recentFailures: z.array(z.record(z.unknown())),
  })
  .passthrough();

export const endpointObservabilitySchema = z
  .object({
    endpoints: endpointUrlsSchema,
    telemetry: z.object({
      calls: z.number().int().nonnegative(),
      failures: z.number().int().nonnegative(),
      errorRate: z.number().nonnegative(),
      averageLatencyMs: z.number().nonnegative(),
      p95LatencyMs: z.number().nonnegative(),
      comparisons: executionComparisonsSchema,
      window: z.literal("24h"),
    }),
    runtimeHealth: z.object({
      status: z.enum(["healthy", "degraded", "unavailable"]),
      reachable: z.boolean(),
      activeDeploymentLoadable: z.boolean(),
      statusCode: z.number().int().optional(),
      checkedAt: z.coerce.date(),
      dependencies: z.object({
        controlPlaneDatabase: z.literal("healthy"),
        cache: z.enum(["healthy", "unavailable"]),
        activeDeployment: z.enum(["healthy", "unavailable"]),
      }),
    }),
    securityPosture: z.object({
      endpointAuthentication: z.enum(["enforced", "not_configured"]),
      defaultPolicy: z
        .object({ id: z.string(), name: z.string(), type: z.string() })
        .nullable(),
      snapshottedPolicyCount: z.number().int().nonnegative(),
      source: z.enum(["active_snapshot", "database"]),
      network: z.object({
        configured: z.boolean(),
        allowedHostCount: z.number().int().nonnegative(),
        allowedMethods: z.array(z.unknown()),
        maxResponseBytes: z.number().int().positive().nullable(),
      }),
      trustedDeveloperExecution: z.boolean(),
    }),
    storageMetrics: z.object({
      storage: z.object({
        namespaces: z.number().int().nonnegative(),
        storedKeys: z.number().int().nonnegative(),
        activeKeys: z.number().int().nonnegative(),
        expiredKeys: z.number().int().nonnegative(),
        valuesExposed: z.literal(false),
      }),
      cache: z.object({
        status: z.enum(["available", "partial", "unavailable"]),
        activeKeys: z.number().int().nonnegative().nullable(),
        approximate: z.boolean(),
        hitRate: z.null(),
        hitRateAvailable: z.literal(false),
        keyMaterialExposed: z.literal(false),
      }),
    }),
  })
  .passthrough();

export const deploymentSummarySchema = z.object({
  activeSnapshots: z.number().int().nonnegative(),
  sevenDayDeployments: z.number().int().nonnegative(),
  successfulDeployments: z.number().int().nonnegative(),
  failedDeployments: z.number().int().nonnegative(),
  inProgressDeployments: z.number().int().nonnegative(),
  averageBuildDurationMs: z.number().int().nonnegative().nullable(),
});
export const deploymentListResponseSchema = z.object({
  items: z.array(z.record(z.unknown())),
  summary: deploymentSummarySchema,
});

export type FunctionCreateInput = z.infer<typeof functionCreateSchema>;
