import { describe, expect, it } from "vitest";
import { functionTemplates } from "./templates.js";

describe("operational function templates", () => {
  it("ships versioned fixtures and setup documentation for every template", () => {
    expect(functionTemplates).toHaveLength(7);
    for (const template of functionTemplates) {
      expect(template.fixtures.version).toBe(1);
      expect(template.fixtures.items.length).toBeGreaterThan(0);
      expect(template.documentation.purpose.length).toBeGreaterThan(0);
      expect(template.documentation.setup.length).toBeGreaterThan(0);
      expect(template.documentation.exampleCalls.length).toBeGreaterThan(0);
      expect(template.documentation.limitations.length).toBeGreaterThan(0);
    }
  });

  it("does not advertise unavailable providers as runnable", () => {
    const postgres = functionTemplates.find((template) => template.id === "postgres-read-query");
    const webhook = functionTemplates.find((template) => template.id === "webhook");
    expect(postgres?.availability).toMatchObject({ status: "requires_configuration", enabledByDefault: false });
    expect(webhook?.availability).toMatchObject({ status: "requires_configuration", enabledByDefault: false });
  });

  it("labels synthetic search output as a local example", () => {
    const search = functionTemplates.find((template) => template.id === "read-search");
    expect(search?.localExample).toBe(true);
    expect(search?.code).toContain("synthetic-local-example");
    expect(search?.documentation.limitations.join(" ")).toContain("synthetic data");
  });
});
