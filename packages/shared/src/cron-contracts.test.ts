import { describe, expect, it } from "vitest";
import { cronBindingSchema, isFiveFieldCron, isIanaTimezone } from "./contracts.js";

const binding = {
  environmentId: "11111111-1111-4111-8111-111111111111",
  functionId: "22222222-2222-4222-8222-222222222222",
  name: "Nightly reconciliation",
  expression: "0 2 * * 1-5",
  timezone: "Europe/Berlin",
  enabled: true,
  serviceSubject: "cron-reconciliation",
  permissionGrants: ["customers.read"],
  networkPolicy: {
    allowedHosts: ["api.example.com"],
    allowedMethods: ["GET"],
    allowedPorts: [443],
    maxResponseBytes: 1_048_576,
    allowPrivateHosts: [],
    allowInsecureTlsHosts: [],
  },
};

describe("cron binding contracts", () => {
  it("accepts exactly five bounded cron fields and an IANA timezone", () => {
    expect(cronBindingSchema.parse(binding)).toMatchObject({
      expression: "0 2 * * 1-5",
      timezone: "Europe/Berlin",
    });
    expect(isFiveFieldCron("*/5 * * * *")).toBe(true);
    expect(isIanaTimezone("America/New_York")).toBe(true);
  });

  it.each([
    "0 0 0 * * *",
    "60 * * * *",
    "* 24 * * *",
    "* * 0 * *",
    "* * * 13 *",
    "* * * * 8",
    "*/0 * * * *",
  ])("rejects invalid expression %s", (expression) => {
    expect(isFiveFieldCron(expression)).toBe(false);
    expect(() => cronBindingSchema.parse({ ...binding, expression })).toThrow();
  });

  it("rejects aliases that are not valid IANA timezones", () => {
    expect(isIanaTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(() =>
      cronBindingSchema.parse({ ...binding, timezone: "Mars/Olympus_Mons" }),
    ).toThrow();
  });
});
