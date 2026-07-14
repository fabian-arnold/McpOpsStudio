import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
export function parseMasterKey(encoded: string | undefined): Buffer {
  if (!encoded) throw new Error("MCP_OPS_MASTER_KEY is required");
  const key = /^[0-9a-f]{64}$/i.test(encoded)
    ? Buffer.from(encoded, "hex")
    : Buffer.from(encoded, "base64");
  if (key.length !== 32)
    throw new Error(
      "MCP_OPS_MASTER_KEY must encode exactly 32 bytes (64 hex characters or base64)",
    );
  return key;
}
export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}
export function decryptSecret(payload: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key");
  const separator = payload.startsWith("v1:") ? ":" : ".";
  const [version, iv, tag, encrypted, ...extra] = payload.split(separator);
  if (version !== VERSION || !iv || !tag || !encrypted || extra.length)
    throw new Error("Encrypted secret has an invalid format");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Encrypted secret could not be authenticated");
  }
}
