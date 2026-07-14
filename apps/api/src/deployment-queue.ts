import type { JobsOptions } from "bullmq";

export const deploymentJobOptions = (jobId: string): JobsOptions => ({
  jobId,
  attempts: 5,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: 100,
  removeOnFail: 100,
});
