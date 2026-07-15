import { describe, expect, it } from "vitest";
import { authorizePermissions, redactSensitive, SafeRuntimeError } from "./index.js";

describe("redaction", () => {
  it("redacts nested credentials and known values", () => {
    expect(
      redactSensitive(
        { headers: { authorization: "Bearer abc" }, note: "value=s3cret" },
        ["s3cret"],
      ),
    ).toEqual({
      headers: { authorization: "[REDACTED]" },
      note: "value=[REDACTED]",
    });
  });
  it("preserves dates while redacting structured values", () => {
    const createdAt = new Date("2026-07-10T12:30:00.000Z");
    expect(redactSensitive({ createdAt })).toEqual({ createdAt });
  });
});
describe("authorization", () => {
  it("requires every permission", () => {
    expect(() =>
      authorizePermissions(
        { permissions: ["customers.read"], claims: {} },
        ["customers.write"],
        "r1",
      ),
    ).toThrow(SafeRuntimeError);
  });
});
describe("runtime diagnostics", () => {
  it("exposes connection diagnostics only through the explicit diagnostic shape", () => {
    const error = new SafeRuntimeError({
      code: "UPSTREAM_ERROR",
      message: "The upstream service could not be reached.",
      requestId: "request-1",
      diagnostic: {
        code: "HTTP_CONNECT_FAILED",
        host: "sap.internal",
        port: 50000,
        phase: "tls",
        cause: "CERT_UNTRUSTED",
      },
    });
    expect(error.toJSON()).not.toHaveProperty("diagnostic");
    expect(error.toDiagnosticJSON()).toMatchObject({
      diagnostic: { host: "sap.internal", port: 50000, phase: "tls" },
    });
  });
});
