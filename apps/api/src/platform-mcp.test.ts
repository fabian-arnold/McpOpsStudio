import { describe, expect, it, vi } from "vitest";

vi.mock("./resources.js", () => ({
  controlPlaneState: {
    del: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

describe("platform MCP module", () => {
  it("initializes its tool catalog without module-order errors", async () => {
    await expect(import("./platform-mcp.js")).resolves.toMatchObject({
      registerPlatformMcpRoutes: expect.any(Function),
    });
  });
});
