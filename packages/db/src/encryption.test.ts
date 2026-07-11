import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./encryption.js";

const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("secret encryption", () => {
  it("round trips with AES-256-GCM without embedding plaintext", () => {
    const encrypted = encryptSecret("highly-sensitive", key);
    expect(encrypted).not.toContain("highly-sensitive");
    expect(decryptSecret(encrypted, key)).toBe("highly-sensitive");
  });

  it("rejects tampered authenticated ciphertext", () => {
    const encrypted = encryptSecret("highly-sensitive", key);
    const parts = encrypted.split(":");
    const ciphertext = Buffer.from(parts[3]!, "base64url");
    ciphertext[0] = ciphertext[0]! ^ 1;
    parts[3] = ciphertext.toString("base64url");
    const tampered = parts.join(":");
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it("fails closed for invalid master keys", () => {
    expect(() => encryptSecret("value", "short-key")).toThrow(/32 bytes/);
  });
});
