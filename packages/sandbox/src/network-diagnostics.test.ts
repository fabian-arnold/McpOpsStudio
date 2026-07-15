import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
const { insecureFetch } = vi.hoisted(() => ({ insecureFetch: vi.fn() }));
vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetch: insecureFetch,
}));

import { lookup } from "node:dns/promises";
import { SafeRuntimeError } from "@mcpops/runtime-sdk";
import { assertAllowedUrl, PolicyHttpClient } from "./network.js";

const mockedLookup = vi.mocked(lookup);

describe("outbound connection diagnostics", () => {
  beforeEach(() => {
    mockedLookup.mockReset();
    insecureFetch.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

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

  it("requires an exact policy grant before disabling TLS verification", async () => {
    mockedLookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }] as never);
    insecureFetch.mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const basePolicy = {
      allowedHosts: ["sap.example.test"],
      allowedMethods: ["POST"],
      allowedPorts: [50000],
      maxResponseBytes: 1024,
    };
    await expect(
      new PolicyHttpClient(basePolicy, "request-2").request({
        url: "https://sap.example.test:50000/login",
        method: "POST",
        tls: { rejectUnauthorized: false },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(insecureFetch).not.toHaveBeenCalled();

    await expect(
      new PolicyHttpClient(
        { ...basePolicy, allowInsecureTlsHosts: ["sap.example.test"] },
        "request-3",
      ).request({
        url: "https://sap.example.test:50000/login",
        method: "POST",
        tls: { rejectUnauthorized: false },
      }),
    ).resolves.toMatchObject({ status: 200, data: { ok: true } });
    expect(insecureFetch.mock.calls[0]?.[1]).toHaveProperty("dispatcher");
  });

  it("revalidates the insecure TLS grant after redirects", async () => {
    mockedLookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }] as never);
    insecureFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://login.example.test/session" },
      }),
    );
    await expect(
      new PolicyHttpClient(
        {
          allowedHosts: ["sap.example.test", "login.example.test"],
          allowedMethods: ["POST"],
          allowedPorts: [443],
          maxResponseBytes: 1024,
          allowInsecureTlsHosts: ["sap.example.test"],
        },
        "request-4",
      ).request({
        url: "https://sap.example.test/login",
        method: "POST",
        tls: { rejectUnauthorized: false },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(insecureFetch).toHaveBeenCalledTimes(1);
  });
});
