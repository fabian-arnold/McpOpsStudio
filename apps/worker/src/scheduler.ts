import { randomUUID } from "node:crypto";
import type { Job, Queue } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "@mcpops/db";
import { MAX_FUNCTION_TIMEOUT_MS } from "@mcpops/shared";

const lockRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
});

export const CRON_INVOCATION_TIMEOUT_MS = MAX_FUNCTION_TIMEOUT_MS + 30_000;
export const SCHEDULE_JOB_LOCK_DURATION_MS = CRON_INVOCATION_TIMEOUT_MS + 60_000;
export const SCHEDULE_JOB_LOCK_RENEW_TIME_MS = 60_000;
export const SCHEDULE_OVERLAP_LOCK_MS = CRON_INVOCATION_TIMEOUT_MS + 60_000;

export async function closeSchedulerResources(): Promise<void> {
  if (lockRedis.status !== "wait" && lockRedis.status !== "end") await lockRedis.quit();
}

export type ScheduleJobData = {
  bindingId?: string;
  scheduleDeploymentId?: string;
  scheduledAt?: string;
  origin?: "scheduled" | "manual";
  requestId?: string;
};

export function schedulerId(environmentId: string, bindingId: string): string {
  return `cron-${environmentId}-${bindingId}`;
}

export function bullCronPattern(expression: string): string {
  return `0 ${expression.trim()}`;
}

export function isCronMisfire(scheduledAt: Date, now = Date.now()): boolean {
  return now - scheduledAt.getTime() > 60_000;
}

export function staleRunCutoff(now = Date.now()): Date {
  return new Date(now - SCHEDULE_JOB_LOCK_DURATION_MS);
}

export async function recoverStaleRuns(now = Date.now()): Promise<{
  missed: number;
  failed: number;
}> {
  const cutoff = staleRunCutoff(now);
  const [scheduled, running] = await prisma.$transaction([
    prisma.scheduledRun.updateMany({
      where: { status: "scheduled", createdAt: { lt: cutoff } },
      data: {
        status: "missed",
        completedAt: new Date(now),
        reason: "scheduler_claim_abandoned",
      },
    }),
    prisma.scheduledRun.updateMany({
      where: { status: "running", triggeredAt: { lt: cutoff } },
      data: {
        status: "failed",
        completedAt: new Date(now),
        reason: "worker_lease_expired",
      },
    }),
  ]);
  return { missed: scheduled.count, failed: running.count };
}

export async function reconcileSchedulers(queue: Queue): Promise<void> {
  await recoverStaleRuns();
  const active = await prisma.scheduleDeployment.findMany({
    where: {
      status: "active",
      projectDeployment: { activeForEnvironment: { isNot: null } },
    },
    select: { id: true, environmentId: true, snapshot: true },
  });
  const desired = new Map<
    string,
    {
      bindingId: string;
      scheduleDeploymentId: string;
      expression: string;
      timezone: string;
    }
  >();
  for (const deployment of active) {
    const snapshot = object(deployment.snapshot);
    const slice = array(snapshot.slices)
      .map(object)
      .find((item) => object(item.environment).id === deployment.environmentId);
    for (const bindingValue of array(slice?.bindings)) {
      const binding = object(bindingValue);
      if (
        binding.enabled !== true ||
        typeof binding.id !== "string" ||
        typeof binding.expression !== "string" ||
        typeof binding.timezone !== "string"
      )
        continue;
      desired.set(schedulerId(deployment.environmentId, binding.id), {
        bindingId: binding.id,
        scheduleDeploymentId: deployment.id,
        expression: binding.expression,
        timezone: binding.timezone,
      });
    }
  }
  const existing = await queue.getJobSchedulers(0, 1000, true);
  for (const scheduler of existing)
    if (scheduler.key.startsWith("cron-") && !desired.has(scheduler.key))
      await queue.removeJobScheduler(scheduler.key);
  for (const [id, item] of desired)
    await queue.upsertJobScheduler(
      id,
      {
        pattern: bullCronPattern(item.expression),
        tz: item.timezone,
      },
      {
        name: "cron-run",
        data: {
          bindingId: item.bindingId,
          scheduleDeploymentId: item.scheduleDeploymentId,
          origin: "scheduled",
        },
        opts: { attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
      },
    );
}

// Tick disposition is deliberately centralized to keep claim, lock, and final
// durable status transitions in one auditable path.
// eslint-disable-next-line complexity
export async function processScheduleJob(queue: Queue, job: Job): Promise<void> {
  if (job.name === "reconcile") {
    await reconcileSchedulers(queue);
    return;
  }
  const data = job.data as ScheduleJobData;
  if (!data.bindingId || !data.scheduleDeploymentId)
    throw new Error("Cron job is missing immutable schedule lineage");
  const origin = data.origin ?? "scheduled";
  const scheduledAt = new Date(
    data.scheduledAt ??
      (typeof job.opts.prevMillis === "number" ? job.opts.prevMillis : job.timestamp),
  );
  const runRequestId = data.requestId ?? randomUUID();
  const claim = await claimRun({
    bindingId: data.bindingId,
    scheduleDeploymentId: data.scheduleDeploymentId,
    scheduledAt,
    origin,
    requestId: runRequestId,
  });
  if (!claim || claim.status !== "scheduled") return;
  if (origin === "scheduled" && isCronMisfire(scheduledAt)) {
    await prisma.scheduledRun.updateMany({
      where: { id: claim.id, status: "running" },
      data: {
        status: "missed",
        completedAt: new Date(),
        reason: "misfire_grace_exceeded",
      },
    });
    return;
  }
  const lockKey = `mcpops:cron-lock:${data.bindingId}`;
  const lockToken = randomUUID();
  const acquired = await lockRedis.set(
    lockKey,
    lockToken,
    "PX",
    SCHEDULE_OVERLAP_LOCK_MS,
    "NX",
  );
  if (acquired !== "OK") {
    await prisma.scheduledRun.update({
      where: { id: claim.id },
      data: { status: "skipped", completedAt: new Date(), reason: "overlap" },
    });
    return;
  }
  try {
    await prisma.scheduledRun.update({
      where: { id: claim.id },
      data: { status: "running", triggeredAt: new Date() },
    });
    const base = (process.env.RUNTIME_INTERNAL_URL ?? "http://127.0.0.1:8080").replace(
      /\/+$/,
      "",
    );
    const response = await fetch(`${base}/internal/cron-runs/${claim.id}/invoke`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.INTERNAL_API_TOKEN
          ? { "x-internal-token": process.env.INTERNAL_API_TOKEN }
          : {}),
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(CRON_INVOCATION_TIMEOUT_MS),
    });
    const result = (await response.json().catch(() => ({}))) as {
      executionId?: string;
      status?: string;
      error?: { message?: string };
    };
    await prisma.scheduledRun.update({
      where: { id: claim.id },
      data: {
        status: response.ok && result.status === "success" ? "success" : "failed",
        completedAt: new Date(),
        ...(result.executionId ? { executionId: result.executionId } : {}),
        ...(!response.ok || result.status !== "success"
          ? {
              reason:
                result.error?.message?.slice(0, 500) ?? "runtime_invocation_failed",
            }
          : {}),
      },
    });
  } catch (error) {
    await prisma.scheduledRun.updateMany({
      where: { id: claim.id, status: "running" },
      data: {
        status: "failed",
        completedAt: new Date(),
        reason:
          error instanceof Error && error.name === "TimeoutError"
            ? "runtime_invocation_timeout"
            : "runtime_invocation_error",
      },
    });
    throw error;
  } finally {
    await lockRedis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lockKey,
      lockToken,
    );
  }
}

async function claimRun(input: {
  bindingId: string;
  scheduleDeploymentId: string;
  scheduledAt: Date;
  origin: "scheduled" | "manual";
  requestId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const deployment = await tx.scheduleDeployment.findUnique({
      where: { id: input.scheduleDeploymentId },
      include: {
        projectDeployment: {
          select: { environment: { select: { activeProjectDeploymentId: true } } },
        },
      },
    });
    if (!deployment) return null;
    const active =
      deployment.projectDeployment.environment.activeProjectDeploymentId ===
      deployment.projectDeploymentId;
    const inserted = await tx.scheduledRun.createMany({
      data: {
        projectId: deployment.projectId,
        environmentId: deployment.environmentId,
        cronBindingId: input.bindingId,
        scheduleDeploymentId: deployment.id,
        scheduledAt: input.scheduledAt,
        origin: input.origin,
        requestId: input.requestId,
        status: active ? "scheduled" : "missed",
        ...(!active
          ? { completedAt: new Date(), reason: "stale_schedule_deployment" }
          : {}),
      },
      skipDuplicates: true,
    });
    if (inserted.count === 0) return null;
    return tx.scheduledRun.findUniqueOrThrow({
      where: {
        scheduleDeploymentId_cronBindingId_scheduledAt: {
          scheduleDeploymentId: deployment.id,
          cronBindingId: input.bindingId,
          scheduledAt: input.scheduledAt,
        },
      },
    });
  });
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
