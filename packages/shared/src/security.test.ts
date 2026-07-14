import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hasPermissions,
  immutableSnapshot,
  redactSensitive,
  verifyApiKey,
} from "./security.js";

describe("security helpers", () => {
  const key = Buffer.alloc(32, 7);
  it("round trips AES-256-GCM", () =>
    expect(decryptSecret(encryptSecret("secret", key), key)).toBe("secret"));
  it("rejects tampered ciphertext", () =>
    expect(() => decryptSecret(encryptSecret("secret", key) + "x", key)).toThrow());
  it("authorizes complete permission sets", () =>
    expect(hasPermissions({ permissions: ["a", "b"] }, ["a", "b"])).toBe(true));
  it("verifies API keys without direct comparison", () =>
    expect(verifyApiKey("abc", "abc")).toBe(true));
  it("redacts nested sensitive material", () =>
    expect(
      redactSensitive({
        authorization: "Bearer abc",
        nested: { password: "x" },
      }),
    ).toEqual({
      authorization: "[REDACTED]",
      nested: { password: "[REDACTED]" },
    }));
  it("preserves dates in redacted API records", () => {
    const createdAt = new Date("2026-07-10T12:30:00.000Z");
    const result = redactSensitive({ createdAt, authorization: "Bearer abc" });
    expect(result).toEqual({ createdAt, authorization: "[REDACTED]" });
    expect(JSON.parse(JSON.stringify(result)).createdAt).toBe(
      "2026-07-10T12:30:00.000Z",
    );
  });
  it("preserves operational identifiers while redacting token shapes", () => {
    const id = "4dff69a7-a1fa-4e21-b89e-e457c563dce9";
    expect(
      redactSensitive({
        id,
        requestId: id,
        message: "Authorization: Bearer abc.def-123",
        jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
      }),
    ).toEqual({
      id,
      requestId: id,
      message: "Authorization: Bearer [REDACTED]",
      jwt: "[REDACTED]",
    });
  });
  it("creates immutable deployment data", () => {
    const value = immutableSnapshot({ functions: [{ version: 1 }] });
    expect(Object.isFrozen(value.functions[0])).toBe(true);
    expect(() => {
      value.functions[0]!.version = 2;
    }).toThrow();
  });
});
