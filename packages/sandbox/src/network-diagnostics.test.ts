import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "node:dns/promises";
import { SafeRuntimeError } from "@mcpops/runtime-sdk";
import { assertAllowedUrl } from "./network.js";

const mockedLookup = vi.mocked(lookup);

describe("outbound connection diagnostics", () => {
  beforeEach(() => mockedLookup.mockReset());

  it("keeps DNS details internal while exposing them to explicit Function tests", async () => {
    mockedLookup.mockRejectedValueOnce(
      Object.assign(new Error("lookup failed"), { code: "ENOTFOUND" }),
    );
    const result = assertAllowedUrl(
      "https://sap.example.test:50000/health",
      {
        allowedHosts: ["sap.example.test"],
        allowedMethods: ["GET"],
        allowedPorts: [50000],
        maxResponseBytes: 1024,
      },
      "request-1",
    );
    const error = await result.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SafeRuntimeError);
    expect((error as SafeRuntimeError).toJSON()).not.toHaveProperty("diagnostic");
    expect((error as SafeRuntimeError).toDiagnosticJSON()).toMatchObject({
      diagnostic: {
        code: "HTTP_CONNECT_FAILED",
        host: "sap.example.test",
        port: 50000,
        phase: "dns",
        cause: "ENOTFOUND",
      },
    });
  });
});
