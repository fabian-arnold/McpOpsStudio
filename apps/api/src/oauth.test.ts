import { describe, expect, it } from "vitest";
import {
  allowedScopesForRole,
  hashToken,
  parseScopes,
  validRedirectUri,
} from "./oauth.js";

describe("platform MCP OAuth safety", () => {
  it("accepts HTTPS and loopback redirects only", () => {
    expect(validRedirectUri("https://ide.example/callback")).toBe(true);
    expect(validRedirectUri("http://127.0.0.1:43123/callback")).toBe(true);
    expect(validRedirectUri("http://localhost:3000/callback")).toBe(true);
    expect(validRedirectUri("http://ide.example/callback")).toBe(false);
    expect(validRedirectUri("https://user:password@ide.example/callback")).toBe(false);
  });

  it("limits capabilities by installation-wide role", () => {
    expect(allowedScopesForRole("viewer")).toEqual(["mcpops:read"]);
    expect(allowedScopesForRole("operator")).toEqual(["mcpops:read", "mcpops:deploy"]);
    expect(allowedScopesForRole("developer")).toEqual([
      "mcpops:read",
      "mcpops:write",
      "mcpops:deploy",
    ]);
    expect(parseScopes("mcpops:read unknown mcpops:write")).toEqual([
      "mcpops:read",
      "mcpops:write",
    ]);
  });

  it("stores stable hashes rather than opaque token values", () => {
    expect(hashToken("secret-token")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("secret-token")).not.toContain("secret-token");
  });
});
