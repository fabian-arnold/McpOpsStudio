import { prisma } from "@mcpops/db";
import { redactSensitive } from "@mcpops/shared";
import { executionView } from "./observability-routes.js";

export const observabilityToolNames = new Set([
  "executions_list",
  "execution_get",
  "execution_logs",
  "deployments_list",
  "deployment_get",
  "deployment_logs",
]);

type Args = Record<string, unknown>;

export async function callObservabilityTool(
  name: string,
  projectId: string,
  args: Args,
): Promise<Record<string, unknown>> {
  if (name === "executions_list") return executionsList(projectId, args);
  if (name === "execution_get") return executionGet(projectId, text(args.execution));
  if (name === "execution_logs")
    return executionLogs(projectId, text(args.execution), limit(args.limit));
  if (name === "deployments_list") return deploymentsList(projectId, args);
  if (name === "deployment_get") return deploymentGet(projectId, text(args.deployment));
  if (name === "deployment_logs")
    return deploymentLogs(projectId, text(args.deployment), limit(args.limit));
  throw toolError("UNKNOWN_TOOL", `Unknown observability tool: ${name}`);
}

async function executionsList(projectId: string, args: Args) {
  const rows = await prisma.functionExecution.findMany({
    where: {
      projectId,
      ...(typeof args.status === "string" ? { status: args.status as never } : {}),
      ...(typeof args.endpoint === "string"
        ? { endpoint: identifier(args.endpoint) }
        : {}),
      ...(typeof args.function === "string"
        ? { function: identifier(args.function) }
        : {}),
      ...(typeof args.requestId === "string" ? { requestId: args.requestId } : {}),
    },
    include: executionIncludes,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit(args.limit),
  });
  return output(`${rows.length} execution(s)`, {
    executions: redactSensitive(rows.map(executionView)),
  });
}

async function executionGet(projectId: string, id: string) {
  const row = await prisma.functionExecution.findFirst({
    where: { id, projectId },
    include: executionIncludes,
  });
  if (!row) throw toolError("NOT_FOUND", "Execution not found", 404);
  return output("Execution details", {
    execution: redactSensitive(executionView(row)),
  });
}

async function executionLogs(projectId: string, executionId: string, take: number) {
  const exists = await prisma.functionExecution.count({
    where: { id: executionId, projectId },
  });
  if (!exists) throw toolError("NOT_FOUND", "Execution not found", 404);
  const rows = await prisma.runtimeLog.findMany({
    where: { projectId, executionId },
    select: {
      id: true,
      level: true,
      message: true,
      metadata: true,
      requestId: true,
      correlationId: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
  });
  return output(`${rows.length} execution log(s)`, {
    logs: redactSensitive(rows),
  });
}

async function deploymentsList(projectId: string, args: Args) {
  const rows = await prisma.projectDeployment.findMany({
    where: {
      projectId,
      ...(typeof args.status === "string" ? { status: args.status as never } : {}),
      ...(typeof args.environment === "string"
        ? { environment: identifier(args.environment) }
        : {}),
    },
    include: {
      environment: { select: { id: true, name: true, slug: true } },
      _count: { select: { endpointDeployments: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit(args.limit),
  });
  return output(`${rows.length} deployment(s)`, {
    deployments: rows.map((row) => ({
      id: row.id,
      version: row.version,
      status: row.status,
      checksum: row.checksum,
      environment: row.environment,
      endpointCount: row._count.endpointDeployments,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    })),
  });
}

async function deploymentGet(projectId: string, id: string) {
  const row = await prisma.projectDeployment.findFirst({
    where: { id, projectId },
    include: {
      environment: { select: { id: true, name: true, slug: true } },
      endpointDeployments: {
        select: {
          id: true,
          version: true,
          status: true,
          checksum: true,
          createdAt: true,
          completedAt: true,
          endpoint: { select: { id: true, name: true, slug: true, kind: true } },
        },
      },
    },
  });
  if (!row) throw toolError("NOT_FOUND", "Deployment not found", 404);
  const { snapshot: _snapshot, ...safe } = row;
  return output(`Deployment v${row.version}`, { deployment: safe });
}

async function deploymentLogs(projectId: string, id: string, take: number) {
  const deployment = await prisma.projectDeployment.findFirst({
    where: { id, projectId },
    select: { endpointDeployments: { select: { id: true } } },
  });
  if (!deployment) throw toolError("NOT_FOUND", "Deployment not found", 404);
  const rows = await prisma.deploymentLog.findMany({
    where: {
      deploymentId: { in: deployment.endpointDeployments.map((row) => row.id) },
    },
    select: {
      id: true,
      deploymentId: true,
      level: true,
      message: true,
      metadata: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
  });
  return output(`${rows.length} deployment log(s)`, {
    logs: redactSensitive(rows),
  });
}

const executionIncludes = {
  function: { select: { name: true } },
  deployment: { select: { version: true } },
  functionVersion: { select: { version: true } },
  mcpToolBinding: { select: { toolName: true } },
  httpRouteBinding: { select: { method: true, path: true } },
} as const;

function identifier(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? { id: value }
    : { OR: [{ slug: value }, { name: value }] };
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value)
    throw toolError("VALIDATION_ERROR", "Identifier is required");
  return value;
}
function limit(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(1, Math.min(value, 200))
    : 50;
}
function output(summary: string, data: unknown) {
  return { ok: true, summary, data, warnings: [], diagnostics: [], nextActions: [] };
}
function toolError(code: string, message: string, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
