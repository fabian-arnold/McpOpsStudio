import { prisma } from "@mcpops/db";
import type { LoadedEndpoint } from "./domain.js";
import { client } from "./repository-client.js";
import { compact } from "./storage-repository.js";

export type ExecutionRecord = {
  id?: string;
  projectId: string;
  endpointId: string;
  functionId: string;
  functionVersionId: string;
  mcpToolBindingId?: string;
  httpRouteBindingId?: string;
  deploymentId: string;
  requestId: string;
  correlationId?: string;
  invocationSource: string;
  callerIdentity: unknown;
  input: unknown;
  output?: unknown;
  error?: unknown;
  durationMs: number;
  status: string;
  parentExecutionId?: string;
  rootExecutionId?: string;
};
export async function saveExecution(record: ExecutionRecord): Promise<{ id: string }> {
  return client.functionExecution.create({ data: compact(record) }) as Promise<{
    id: string;
  }>;
}
export type RuntimeLogRecord = {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: unknown;
  metadata?: unknown;
  requestId: string;
  executionId: string;
  functionId: string;
  correlationId?: string;
};
export async function saveRuntimeLogs(
  endpoint: LoadedEndpoint,
  events: readonly RuntimeLogRecord[],
): Promise<void> {
  if (events.length)
    await prisma.runtimeLog.createMany({
      data: events.map((event) => {
        const message = String(event.message).slice(0, 8_000);
        const metadata = boundedLogMetadata(event.metadata);
        return {
          projectId: endpoint.project.id,
          environmentId: endpoint.environment.id,
          endpointId: endpoint.id,
          functionId: event.functionId,
          deploymentId: endpoint.deployment.id,
          executionId: event.executionId,
          requestId: event.requestId,
          ...(event.correlationId ? { correlationId: event.correlationId } : {}),
          level: event.level,
          message,
          ...(metadata === undefined ? {} : { metadata: metadata as never }),
          sizeBytes: Buffer.byteLength(JSON.stringify({ message, metadata }), "utf8"),
          createdAt: new Date(event.timestamp),
        };
      }),
    });
  await pruneRuntimeLogs(endpoint.environment.id, endpoint.environment);
}

async function pruneRuntimeLogs(
  environmentId: string,
  settings: Pick<
    LoadedEndpoint["environment"],
    "logRetentionDays" | "logRetentionMaxEntries" | "logRetentionMaxBytes"
  >,
): Promise<void> {
  await prisma.runtimeLog.deleteMany({
    where: {
      environmentId,
      createdAt: { lt: new Date(Date.now() - settings.logRetentionDays * 86_400_000) },
    },
  });
  const count = await prisma.runtimeLog.count({ where: { environmentId } });
  if (count > settings.logRetentionMaxEntries) {
    const overflow = await prisma.runtimeLog.findMany({
      where: { environmentId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: count - settings.logRetentionMaxEntries,
      select: { id: true },
    });
    await prisma.runtimeLog.deleteMany({
      where: { id: { in: overflow.map((item) => item.id) } },
    });
  }
  let total =
    (
      await prisma.runtimeLog.aggregate({
        where: { environmentId },
        _sum: { sizeBytes: true },
      })
    )._sum.sizeBytes ?? 0;
  while (total > settings.logRetentionMaxBytes) {
    const oldest = await prisma.runtimeLog.findMany({
      where: { environmentId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 1000,
      select: { id: true, sizeBytes: true },
    });
    if (!oldest.length) break;
    const remove: string[] = [];
    for (const row of oldest) {
      remove.push(row.id);
      total -= row.sizeBytes;
      if (total <= settings.logRetentionMaxBytes) break;
    }
    await prisma.runtimeLog.deleteMany({ where: { id: { in: remove } } });
  }
}

function boundedLogMetadata(value: unknown): unknown {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  return Buffer.byteLength(serialized, "utf8") <= 32_000
    ? value
    : { truncated: true, preview: serialized.slice(0, 8_000) };
}

export function logSettings(value: {
  logLevel?: string;
  logRetentionDays?: number;
  logRetentionMaxEntries?: number;
  logRetentionMaxBytes?: number;
}) {
  const level = ["debug", "info", "warn", "error", "off"].includes(value.logLevel ?? "")
    ? (value.logLevel as LoadedEndpoint["environment"]["logLevel"])
    : "info";
  return {
    logLevel: level,
    logRetentionDays: value.logRetentionDays ?? 30,
    logRetentionMaxEntries: value.logRetentionMaxEntries ?? 100000,
    logRetentionMaxBytes: value.logRetentionMaxBytes ?? 104857600,
  };
}
export async function saveAudit(data: {
  projectId: string;
  environmentId?: string;
  endpointId?: string;
  functionId?: string;
  actorType: string;
  actorId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata: unknown;
}): Promise<void> {
  await client.auditEvent.create({ data: compact(data) });
}
