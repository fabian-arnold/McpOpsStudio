export type RollbackTarget = { id: string; version: number; status: "active" | "rolled_back" | "queued" | "building" | "deploying" | "failed" };

export function planRollback(currentDeploymentId: string | null, target: RollbackTarget): { deactivateId: string | null; activateId: string; version: number } {
  if (!(["active", "rolled_back"] as const).includes(target.status as "active" | "rolled_back")) throw new Error("Target is not a valid completed deployment");
  if (currentDeploymentId === target.id) throw new Error("Target deployment is already active");
  return { deactivateId: currentDeploymentId, activateId: target.id, version: target.version };
}
