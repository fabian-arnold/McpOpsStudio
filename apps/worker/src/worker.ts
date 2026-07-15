import { Queue, Worker } from "bullmq";
import { buildDeployment } from "./builder.js";
import { buildScheduleDeployment } from "./schedule-builder.js";
import {
  closeSchedulerResources,
  processScheduleJob,
  reconcileSchedulers,
} from "./scheduler.js";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
};
const worker = new Worker(
  "deployments",
  async (job) => {
    const data = job.data as {
      deploymentId?: string;
      scheduleDeploymentId?: string;
      actorId?: string;
    };
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (data.scheduleDeploymentId)
      await buildScheduleDeployment(data.scheduleDeploymentId);
    else if (data.deploymentId)
      await buildDeployment(data.deploymentId, data.actorId, { finalAttempt });
    else throw new Error("Deployment job has no artifact identifier");
  },
  { connection, concurrency: Number(process.env.DEPLOYMENT_CONCURRENCY ?? 2) },
);
const scheduleQueue = new Queue("schedules", { connection });
const scheduleWorker = new Worker(
  "schedules",
  (job) => processScheduleJob(scheduleQueue, job),
  { connection, concurrency: Number(process.env.SCHEDULE_CONCURRENCY ?? 10) },
);
worker.on("completed", (job) => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "deployment job completed",
      jobId: job.id,
    }),
  );
  void reconcileSchedulers(scheduleQueue).catch((error: unknown) =>
    console.error(
      JSON.stringify({
        level: "error",
        message: "schedule reconciliation failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
  );
});
worker.on("failed", (job, error) =>
  console.error(
    JSON.stringify({
      level: "error",
      message: "deployment job failed",
      jobId: job?.id,
      error: error.message,
    }),
  ),
);
const shutdown = async () => {
  await Promise.all([
    worker.close(),
    scheduleWorker.close(),
    scheduleQueue.close(),
    closeSchedulerResources(),
  ]);
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

void reconcileSchedulers(scheduleQueue).catch(() => undefined);
const reconciliationTimer = setInterval(
  () => void reconcileSchedulers(scheduleQueue).catch(() => undefined),
  60_000,
);
reconciliationTimer.unref();
