const sensitiveKey = /authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|client[-_]?secret|refresh[-_]?token/i;
const bearer = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

export function redactSensitive(value: unknown, knownSecrets: readonly string[] = [], seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    let result = value.replace(bearer, "$1[REDACTED]");
    for (const secret of knownSecrets) if (secret.length >= 4) result = result.split(secret).join("[REDACTED]");
    return result;
  }
  if (value instanceof Date) return value;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, knownSecrets, seen));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) output[key] = sensitiveKey.test(key) ? "[REDACTED]" : redactSensitive(item, knownSecrets, seen);
  return output;
}
