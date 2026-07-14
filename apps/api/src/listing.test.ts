import { describe, expect, it } from "vitest";
import { csv, executionListQuerySchema, runtimeLogListQuerySchema } from "./listing.js";

describe("control-plane list filters", () => {
  it("validates bounded pagination and date ranges", () => {
    expect(executionListQuerySchema.parse({ limit: "25", source: "mcp" })).toMatchObject({ limit: 25, source: "mcp" });
    expect(() => executionListQuerySchema.parse({ from: "2026-07-11T00:00:00Z", to: "2026-07-10T00:00:00Z" })).toThrow(/end date/);
    expect(() => executionListQuerySchema.parse({ limit: "1000" })).toThrow();
  });

  it("validates structured runtime log filters", () => {
    expect(runtimeLogListQuerySchema.parse({ level: "warn", q: "request failed", limit: "200" })).toMatchObject({ level: "warn", q: "request failed", limit: 200 });
    expect(() => runtimeLogListQuerySchema.parse({ level: "trace" })).toThrow();
  });

  it("prevents spreadsheet formula execution in CSV exports", () => {
    const output = csv([{ requestId: "=HYPERLINK(\"https://example.test\")", status: "success" }], ["requestId", "status"]);
    expect(output).toContain("'=HYPERLINK");
    expect(output).not.toContain('\n"=HYPERLINK');
  });
});
