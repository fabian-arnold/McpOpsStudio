import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest.js";

const manifest = {
  endpoint: {
    kind: "mcp",
    name: "Internal notes",
    slug: "internal-notes",
  },
};

describe("endpoint manifest network policy", () => {
  it("accepts empty network lists as deny-all outbound access", () => {
    const parsed = parseManifest(
      JSON.stringify({
        ...manifest,
        endpoint: {
          ...manifest.endpoint,
          network: {
            allowedHosts: [],
            allowedMethods: [],
            allowedPorts: [],
          },
        },
      }),
      "json",
    );
    expect(parsed.endpoint.network).toMatchObject({
      allowedHosts: [],
      allowedMethods: [],
      allowedPorts: [],
    });
  });

  it("requires methods and ports when a host is allowlisted", () => {
    expect(() =>
      parseManifest(
        JSON.stringify({
          ...manifest,
          endpoint: {
            ...manifest.endpoint,
            network: {
              allowedHosts: ["api.example.com"],
              allowedMethods: [],
              allowedPorts: [],
            },
          },
        }),
        "json",
      ),
    ).toThrow(/method is required/);
  });

  it("accepts a one-hour endpoint execution window", () => {
    expect(
      parseManifest(
        JSON.stringify({
          ...manifest,
          endpoint: {
            ...manifest.endpoint,
            runtime: { timeoutMs: 3_600_000 },
          },
        }),
        "json",
      ).endpoint.runtime.timeoutMs,
    ).toBe(3_600_000);
  });
});
