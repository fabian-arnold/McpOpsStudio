import { describe, expect, it } from "vitest";
import {
  bullCronPattern,
  CRON_INVOCATION_TIMEOUT_MS,
  isCronMisfire,
  SCHEDULE_JOB_LOCK_DURATION_MS,
  SCHEDULE_JOB_LOCK_RENEW_TIME_MS,
  schedulerId,
} from "./scheduler.js";

describe("cron scheduler identity", () => {
  it("normalizes five fields to BullMQ optional-seconds format", () => {
    expect(bullCronPattern("*/5 * * * *")).toBe("0 */5 * * * *");
  });

  it("is deterministic by environment and binding", () => {
    expect(schedulerId("environment-1", "binding-1")).toBe(
      "cron-environment-1-binding-1",
    );
  });

  it("uses a fixed sixty-second misfire grace", () => {
    const now = Date.parse("2026-07-15T12:01:00.000Z");
    expect(isCronMisfire(new Date("2026-07-15T12:00:00.000Z"), now)).toBe(false);
    expect(isCronMisfire(new Date("2026-07-15T11:59:59.999Z"), now)).toBe(true);
  });

  it("keeps the BullMQ lock beyond the maximum runtime invocation", () => {
    expect(SCHEDULE_JOB_LOCK_DURATION_MS).toBeGreaterThan(CRON_INVOCATION_TIMEOUT_MS);
    expect(SCHEDULE_JOB_LOCK_RENEW_TIME_MS).toBeLessThan(
      SCHEDULE_JOB_LOCK_DURATION_MS / 2,
    );
  });
});
