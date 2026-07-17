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
    const invoke = vi.fn(async (_request: unknown) => ({
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
    const invocation = invoke.mock.calls[0]?.[0] as { requestId?: string };
    expect(invocation.requestId).not.toBe("request-1");
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint,
        fn,
        source: "internal",
        requestId: expect.any(String),
        correlationId: "request-1",
        skipPermissionAuthorization: true,
        suppressPayloadCapture: true,
        suppressLogs: true,
      }),
    );
  });
});
