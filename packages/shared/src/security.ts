import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const SENSITIVE_KEY =
  /authorization|cookie|password|secret|token|api[-_]?key|refresh/i;
const BEARER_VALUE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

export function masterKeyFromEnvironment(
  value = process.env.MCP_OPS_MASTER_KEY,
): Buffer {
  if (!value) throw new Error("MCP_OPS_MASTER_KEY is required");
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32)
    throw new Error(
      "MCP_OPS_MASTER_KEY must encode exactly 32 bytes (64 hex characters or base64)",
    );
  return key;
}

export function encryptSecret(
  plaintext: string,
  key = masterKeyFromEnvironment(),
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(
  payload: string,
  key = masterKeyFromEnvironment(),
): string {
  const parts = payload.split(payload.startsWith("v1:") ? ":" : ".");
  const [version, iv, tag, encrypted] = parts;
  if (parts.length !== 4 || version !== "v1" || !iv || !tag || !encrypted)
    throw new Error("Invalid encrypted secret format");
  const decode = (value: string) => {
    const result = Buffer.from(value, "base64url");
    if (result.toString("base64url") !== value)
      throw new Error("Invalid encrypted secret encoding");
    return result;
  };
  const decipher = createDecipheriv("aes-256-gcm", key, decode(iv));
  decipher.setAuthTag(decode(tag));
  return Buffer.concat([
    decipher.update(decode(encrypted)),
    decipher.final(),
  ]).toString("utf8");
}

export function redactSensitive<T>(value: T, knownSecrets: string[] = []): T {
  const seen = new WeakSet<object>();
  const walk = (item: unknown, key?: string): unknown => {
    if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
    if (typeof item === "string") {
      let output = item
        .replace(BEARER_VALUE, "$1[REDACTED]")
        .replace(JWT_VALUE, "[REDACTED]");
      for (const secret of knownSecrets.filter(Boolean))
        output = output.split(secret).join("[REDACTED]");
      return output;
    }
    // Preserve temporal values so API serializers can emit valid ISO strings.
    // Treating Date as a generic object turns it into `{}` and breaks every
    // redacted observability timestamp.
    if (item instanceof Date) return item;
    if (!item || typeof item !== "object") return item;
    if (seen.has(item)) return "[Circular]";
    seen.add(item);
    if (Array.isArray(item)) return item.map((entry) => walk(entry));
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>).map(([name, entry]) => [
        name,
        walk(entry, name),
      ]),
    );
  };
  return walk(value) as T;
}

export function hasPermissions(
  caller: { permissions: string[] },
  required: string[],
): boolean {
  const granted = new Set(caller.permissions);
  return required.every(
    (permission) => granted.has(permission) || granted.has("*"),
  );
}

export function verifyApiKey(
  provided: string | undefined,
  expected: string,
): boolean {
  if (!provided) return false;
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function immutableSnapshot<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return;
    Object.freeze(item);
    for (const child of Object.values(item)) freeze(child);
  };
  freeze(clone);
  return clone;
}
