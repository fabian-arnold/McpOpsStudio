import { z } from "zod";

const date = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const page = {
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  from: date.optional(),
  to: date.optional(),
};

export const executionListQuerySchema = z
  .object({
    ...page,
    endpointId: z.string().uuid().optional(),
    functionId: z.string().uuid().optional(),
    toolBindingId: z.string().uuid().optional(),
    httpRouteBindingId: z.string().uuid().optional(),
    status: z
      .enum(["success", "error", "denied", "timeout", "validation_error"])
      .optional(),
    requestId: z.string().max(256).optional(),
    callerSubject: z.string().max(512).optional(),
    source: z.enum(["mcp", "http", "test", "internal"]).optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .strict()
  .superRefine(validDateRange);

export const runtimeLogListQuerySchema = z
  .object({
    ...page,
    environmentId: z.string().uuid().optional(),
    endpointId: z.string().uuid().optional(),
    functionId: z.string().uuid().optional(),
    level: z.enum(["debug", "info", "warn", "error"]).optional(),
    requestId: z.string().max(256).optional(),
    correlationId: z.string().max(256).optional(),
    q: z.string().trim().max(512).optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .strict()
  .superRefine(validDateRange);

export const deploymentListQuerySchema = z
  .object({
    ...page,
    environmentId: z.string().uuid().optional(),
    status: z
      .enum(["queued", "building", "deploying", "active", "failed", "rolled_back"])
      .optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .strict()
  .superRefine(validDateRange);

export const auditListQuerySchema = z
  .object({
    ...page,
    endpointId: z.string().uuid().optional(),
    functionId: z.string().uuid().optional(),
    action: z.string().max(256).optional(),
    actorType: z.enum(["user", "caller", "system"]).optional(),
    actorId: z.string().max(512).optional(),
    targetType: z.string().max(256).optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .strict()
  .superRefine(validDateRange);

function validDateRange(
  value: { from?: Date; to?: Date },
  context: z.RefinementCtx,
): void {
  if (value.from && value.to && value.from > value.to)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: "The end date must be after the start date",
    });
}

export function csv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const escape = (value: unknown): string => {
    const raw =
      value === null || value === undefined
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    const formulaSafe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${formulaSafe.replaceAll('"', '""')}"`;
  };
  return `${columns.map(escape).join(",")}\r\n${rows.map((row) => columns.map((column) => escape(row[column])).join(",")).join("\r\n")}`;
}
