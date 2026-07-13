import { describe, expect, it } from "vitest";
import { capturedPayload, shouldCapturePayloads } from "./invoke.js";

describe("development payload capture", () => {
  it("redacts sensitive keys and granted secret values", () => {
    expect(
      capturedPayload(
        {
          password: "hidden",
          message: "credential-value",
          nested: { authorization: "Bearer abc" },
        },
        ["credential-value"],
      ),
    ).toEqual({
      password: "[REDACTED]",
      message: "[REDACTED]",
      nested: { authorization: "[REDACTED]" },
    });
  });

  it("bounds oversized payloads", () => {
    const result = capturedPayload({ value: "x".repeat(70_000) }) as {
      truncated: boolean;
      originalBytes: number;
      preview: string;
    };
    expect(result.truncated).toBe(true);
    expect(result.originalBytes).toBeGreaterThan(64 * 1024);
    expect(result.preview.length).toBeLessThanOrEqual(16_000);
  });

  it("allows capture only in Development", () => {
    expect(
      shouldCapturePayloads({ slug: "development", capturePayloads: true }),
    ).toBe(true);
    expect(
      shouldCapturePayloads({ slug: "production", capturePayloads: true }),
    ).toBe(false);
  });
});
