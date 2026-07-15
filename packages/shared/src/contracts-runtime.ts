import { z } from "zod";
import { slugSchema } from "./contracts-core.js";

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
    allowInsecureTlsHosts: z.array(networkHostSchema).max(50).default([]),
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
    for (const host of policy.allowInsecureTlsHosts ?? [])
      if (host.startsWith("*.") || !policy.allowedHosts.includes(host))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["allowInsecureTlsHosts"],
          message: `Insecure TLS host '${host}' must be an exact allowed host`,
        });
  });

const cronFieldRanges = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const;

export function isFiveFieldCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field, index) => {
    const [min, max] = cronFieldRanges[index]!;
    return field.split(",").every((part) => cronPartIsValid(part, min, max));
  });
}

function cronPartIsValid(part: string, min: number, max: number): boolean {
  const [range = "", step, ...extra] = part.split("/");
  if (extra.length || (step !== undefined && !positiveInteger(step))) return false;
  if (range === "*") return true;
  const values = range.split("-");
  if (values.length > 2 || !values.every(nonNegativeInteger)) return false;
  const start = Number(values[0]);
  const end = Number(values[1] ?? values[0]);
  return start >= min && start <= max && end >= start && end <= max;
}

function positiveInteger(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) > 0;
}

function nonNegativeInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

export function isIanaTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export const cronBindingSchema = z
  .object({
    environmentId: z.string().uuid(),
    functionId: z.string().uuid(),
    name: z.string().trim().min(2).max(120),
    expression: z.string().trim().refine(isFiveFieldCron, {
      message: "Cron expression must contain exactly five valid fields",
    }),
    timezone: z.string().trim().min(1).max(128).refine(isIanaTimezone, {
      message: "Timezone must be a valid IANA timezone",
    }),
    enabled: z.boolean().default(true),
    serviceSubject: z.string().trim().min(1).max(256),
    permissionGrants: z.array(z.string().min(1).max(256)).max(200).default([]),
    networkPolicy: networkPolicyUpdateSchema.default({
      allowedHosts: [],
      allowedMethods: [],
      allowedPorts: [],
      maxResponseBytes: 1_048_576,
      allowPrivateHosts: [],
      allowInsecureTlsHosts: [],
    }),
  })
  .strict();

export const cronBindingUpdateSchema = cronBindingSchema.partial().strict();
export const cronRunsQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
  .strict();
export const cachePurgeSchema = z.object({ confirmEndpointSlug: slugSchema }).strict();
export const testInvocationSchema = z.object({
  endpointId: z.string().uuid().optional(),
  input: z.unknown(),
  source: z.enum(["mcp", "http", "cron", "test"]).default("test"),
  cronBindingId: z.string().uuid().optional(),
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
        allowPrivateHosts: z.array(z.string().regex(/^[a-z0-9.-]+$/i)).default([]),
        allowInsecureTlsHosts: z.array(z.string().regex(/^[a-z0-9.-]+$/i)).default([]),
      })
      .default({ allowPrivateHosts: [], allowInsecureTlsHosts: [] }),
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
