import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function decodeMasterKey(encoded: string | undefined): Buffer {
  if (!encoded) throw new Error("MCP_OPS_MASTER_KEY is required.");
  const key = /^[0-9a-f]{64}$/i.test(encoded)
    ? Buffer.from(encoded, "hex")
    : Buffer.from(encoded, "base64");
  if (key.length !== 32)
    throw new Error("MCP_OPS_MASTER_KEY must decode to exactly 32 bytes.");
  return key;
}

/** AES-256-GCM produces authenticated ciphertext; no plaintext secret is persisted. */
export function encryptSecret(
  plaintext: string,
  encodedKey = process.env.MCP_OPS_MASTER_KEY,
): string {
  const key = decodeMasterKey(encodedKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptSecret(
  payload: string,
  encodedKey = process.env.MCP_OPS_MASTER_KEY,
): string {
  const [version, ivValue, tagValue, ciphertextValue, ...extra] = payload.split(":");
  if (
    version !== VERSION ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra.length
  ) {
    throw new Error("Encrypted secret payload is invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    decodeMasterKey(encodedKey),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
