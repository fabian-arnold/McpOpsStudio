import { describe, expect, it, vi } from "vitest";
import { customAuthenticationInvoker } from "./custom-auth-invoker.js";

describe("custom authentication invocation", () => {
  it("suppresses credential payloads and logs while using the pinned Function", async () => {
    const fn = {
      id: "function-1",
      functionId: "function-1",
      enabled: true,
    };
    const endpoint = { snapshot: { functions: [fn] } };
    const invoke = vi.fn(async () => ({
      ok: true,
      output: {
        authenticated: true,
        subject: "caller",
        permissions: [],
      },
    }));
    const authenticate = customAuthenticationInvoker(
      {
        id: "request-1",
        raw: { aborted: false, once: vi.fn() },
      } as never,
      endpoint as never,
      { invoke } as never,
    );

    await expect(
      authenticate("function-1", {
        request: { headers: { authorization: "credential" } },
      }),
    ).resolves.toMatchObject({ authenticated: true });
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint,
        fn,
        source: "internal",
        skipPermissionAuthorization: true,
        suppressPayloadCapture: true,
        suppressLogs: true,
      }),
    );
  });
});
