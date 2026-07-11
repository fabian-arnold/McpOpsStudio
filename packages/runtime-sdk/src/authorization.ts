import { SafeRuntimeError } from "./errors.js";
import type { CallerIdentity } from "./types.js";

export function authorizePermissions(
  caller: CallerIdentity,
  required: readonly string[],
  requestId: string,
): void {
  if (caller.permissions.includes("*")) return;
  const granted = new Set(caller.permissions);
  const missing = required.filter((permission) => !granted.has(permission));
  if (missing.length)
    throw new SafeRuntimeError({
      code: "FORBIDDEN",
      message: "The caller does not have the required permission.",
      requestId,
    });
}
