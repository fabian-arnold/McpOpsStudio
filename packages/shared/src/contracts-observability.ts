import { z } from "zod";
import { type functionCreateSchema } from "./contracts-core.js";

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
