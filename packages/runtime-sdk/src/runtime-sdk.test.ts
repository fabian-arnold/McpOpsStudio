import { describe, expect, it } from "vitest";
import {
  authorizePermissions,
  redactSensitive,
  SafeRuntimeError,
} from "./index.js";

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
