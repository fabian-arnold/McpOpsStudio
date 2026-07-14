import { describe, expect, it } from "vitest";
import { shouldWriteLog } from "./invoke.js";

describe("environment runtime log levels", () => {
  it("stores messages at or above the configured threshold", () => {
    expect(shouldWriteLog("debug", "debug")).toBe(true);
    expect(shouldWriteLog("info", "debug")).toBe(false);
    expect(shouldWriteLog("info", "info")).toBe(true);
    expect(shouldWriteLog("warn", "info")).toBe(false);
    expect(shouldWriteLog("warn", "error")).toBe(true);
    expect(shouldWriteLog("off", "error")).toBe(false);
  });
});
