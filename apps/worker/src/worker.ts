import { Worker } from "bullmq";
import { buildDeployment } from "./builder.js";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
};
const worker = new Worker(
  "deployments",
  async (job) => {
    const data = job.data as { deploymentId: string; actorId?: string };
    await buildDeployment(data.deploymentId, data.actorId);
  },
  { connection, concurrency: Number(process.env.DEPLOYMENT_CONCURRENCY ?? 2) },
);
worker.on("completed", (job) =>
  console.log(
    JSON.stringify({
      level: "info",
      message: "deployment job completed",
      jobId: job.id,
    }),
  ),
);
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
  await worker.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
