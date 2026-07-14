import { describe, expect, it } from "vitest";
import {
  networkPolicyWarnings,
  providerStatus,
  validateProjectLibrary,
} from "./control-plane-validation.js";

describe("control-plane policy validation", () => {
  it("compiles pure project utility libraries and rejects privileged globals", async () => {
    await expect(
      validateProjectLibrary(
        "@mcpops/lib/customer",
        "export const normalize = (value: string) => value.trim();",
      ),
    ).resolves.toBeUndefined();
    await expect(
      validateProjectLibrary(
        "@mcpops/lib/customer",
        "export const unsafe = () => process.env.SECRET;",
      ),
    ).rejects.toMatchObject({ code: "UNSAFE_LIBRARY" });
  });

  it("returns explicit private and wildcard warnings without DNS lookups", () => {
    expect(networkPolicyWarnings(["10.0.0.1", "*.example.com"], ["10.0.0.1"])).toEqual([
      expect.objectContaining({ code: "PRIVATE_HOST_ALLOWED" }),
      expect.objectContaining({ code: "WILDCARD_HOST" }),
    ]);
  });

  it("does not imply deferred authentication providers are operational", () => {
    expect(providerStatus("api_key")).toBe("enabled");
    expect(providerStatus("jwt", { ENABLE_JWT_AUTH: "true" })).toBe("enabled");
    expect(providerStatus("entra_id", {})).toBe("deferred");
  });
});
