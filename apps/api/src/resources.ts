import { Queue } from "bullmq";
import { Redis } from "ioredis";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
};

export const deploymentQueue = new Queue("deployments", { connection });
export const cacheInspector = new Redis(redisUrl.toString(), {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});
export const controlPlaneState = new Redis(redisUrl.toString(), {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

export async function connectApiResources(): Promise<void> {
  if (controlPlaneState.status === "wait") await controlPlaneState.connect();
}

export async function closeApiResources(): Promise<void> {
  await Promise.all([
    deploymentQueue.close(),
    cacheInspector.quit(),
    controlPlaneState.quit(),
  ]);
}
