import YAML from "yaml";
import { z } from "zod";
import {
  runtimeEnvironmentSchema,
  endpointAccessPolicySchema,
  slugSchema,
} from "./contracts.js";

const manifestNetworkSchema = z
  .object({
    allowedHosts: z.array(z.string()).default([]),
    allowedMethods: z
      .array(z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]))
      .default(["GET"]),
    allowedPorts: z
      .array(z.number().int().min(1).max(65_535))
      .default([443]),
    maxResponseBytes: z
      .number()
      .int()
      .min(1_024)
      .max(10_485_760)
      .default(1_048_576),
    allowPrivateHosts: z.array(z.string()).default([]),
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
    for (const host of policy.allowPrivateHosts)
      if (host.startsWith("*.") || !policy.allowedHosts.includes(host))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["allowPrivateHosts"],
          message: `Private host '${host}' must be an exact allowed host`,
        });
  });

export const manifestSchema = z
  .object({
    endpoint: z
      .object({
        kind: z.enum(["mcp", "http"]),
        name: z.string().min(1),
        slug: slugSchema,
        description: z.string().default(""),
        runtimeVersion: z
          .string()
          .regex(/^[A-Za-z0-9._-]{1,64}$/)
          .default("1"),
        runtime: z
          .object({
            timeoutMs: z.number().int().min(100).max(120_000).default(30_000),
            maxConcurrentRequests: z.number().int().min(1).max(500).default(20),
            env: runtimeEnvironmentSchema.default({}),
            endpointAccessPolicy: endpointAccessPolicySchema.default({
              mode: "authenticated",
              allowedSubjects: [],
            }),
          })
          .default({}),
        network: manifestNetworkSchema.default({}),
      })
      .strict(),
    auth: z.object({ policy: z.string() }).optional(),
    functions: z
      .array(
        z
          .object({
            name: z.string(),
            enabled: z.boolean().default(true),
            riskLevel: z.enum(["read", "write", "destructive"]),
            requiredPermissions: z.array(z.string()).default([]),
          })
          .strict(),
      )
      .default([]),
    mcp: z
      .object({
        tools: z
          .array(
            z
              .object({
                toolName: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
                function: z.string(),
                title: z.string().min(1).max(120).optional(),
                description: z.string().max(2000).default(""),
                enabled: z.boolean().default(true),
              })
              .strict(),
          )
          .default([]),
      })
      .strict()
      .optional(),
    http: z
      .object({
        routes: z
          .array(
            z
              .object({
                method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
                path: z
                  .string()
                  .startsWith("/")
                  .regex(/^\/[A-Za-z0-9_\-/:]*$/),
                function: z.string(),
                inputMapping: z.record(z.unknown()).nullable().optional(),
                responseMapping: z.record(z.unknown()).nullable().optional(),
                enabled: z.boolean().default(true),
              })
              .strict(),
          )
          .default([]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.endpoint.kind === "mcp" && (manifest.http?.routes.length ?? 0) > 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["http"],
        message: "MCP Endpoint manifests cannot contain HTTP routes",
      });
    if (manifest.endpoint.kind === "http" && (manifest.mcp?.tools.length ?? 0) > 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mcp"],
        message: "HTTP API manifests cannot contain MCP tools",
      });
    const functions = new Set<string>();
    for (const [index, fn] of manifest.functions.entries()) {
      if (functions.has(fn.name))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["functions", index, "name"],
          message: "Duplicate function name",
        });
      functions.add(fn.name);
    }
    const tools = new Set<string>();
    for (const [index, tool] of (manifest.mcp?.tools ?? []).entries()) {
      if (tools.has(tool.toolName))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mcp", "tools", index, "toolName"],
          message: "Duplicate MCP tool name",
        });
      tools.add(tool.toolName);
    }
    const routes = new Set<string>();
    for (const [index, route] of (manifest.http?.routes ?? []).entries()) {
      const key = `${route.method} ${route.path}`;
      if (routes.has(key))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["http", "routes", index],
          message: "Duplicate HTTP method/path",
        });
      routes.add(key);
    }
  });

export type EndpointManifest = z.infer<typeof manifestSchema>;
export function parseManifest(
  content: string,
  format: "yaml" | "json",
): EndpointManifest {
  const parsed: unknown =
    format === "json" ? JSON.parse(content) : YAML.parse(content);
  return manifestSchema.parse(parsed);
}
export function serializeManifest(
  manifest: EndpointManifest,
  format: "yaml" | "json",
): string {
  return format === "json"
    ? JSON.stringify(manifest, null, 2)
    : YAML.stringify(manifest);
}
