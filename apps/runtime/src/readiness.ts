export type RuntimeReadiness = {
  ready: boolean;
  checks: { postgres: boolean; redis: boolean; activeDeployments: boolean };
  activeDeploymentCount: number;
};

export async function checkRuntimeReadiness(dependencies: {
  postgres(): Promise<void>;
  redis(): Promise<void>;
  activeDeployments(): Promise<number>;
}, timeoutMs = 2_000): Promise<RuntimeReadiness> {
  const [postgres, redis, deployments] = await Promise.allSettled([
    withTimeout(dependencies.postgres(), timeoutMs), withTimeout(dependencies.redis(), timeoutMs), withTimeout(dependencies.activeDeployments(), timeoutMs)
  ]);
  const checks = { postgres: postgres.status === "fulfilled", redis: redis.status === "fulfilled", activeDeployments: deployments.status === "fulfilled" };
  return { ready: Object.values(checks).every(Boolean), checks,
    activeDeploymentCount: deployments.status === "fulfilled" ? deployments.value : 0 };
}
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Readiness probe timed out")), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); }); });
}
