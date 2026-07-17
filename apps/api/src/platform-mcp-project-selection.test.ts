import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findProject: vi.fn(),
  updateUser: vi.fn(),
  updateUsers: vi.fn(),
}));

vi.mock("@mcpops/db", () => ({
  prisma: {
    project: { findFirst: db.findProject },
    user: { update: db.updateUser, updateMany: db.updateUsers },
  },
}));

import {
  activeRememberedPlatformMcpProjectId,
  rememberPlatformMcpProject,
} from "./platform-mcp-project-selection.js";

describe("Platform MCP project selection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("restores an active remembered project", async () => {
    db.findProject.mockResolvedValue({ id: "project-1" });
    await expect(
      activeRememberedPlatformMcpProjectId("user-1", "project-1"),
    ).resolves.toBe("project-1");
    expect(db.updateUsers).not.toHaveBeenCalled();
  });

  it("clears a remembered project that is no longer active", async () => {
    db.findProject.mockResolvedValue(null);
    await expect(
      activeRememberedPlatformMcpProjectId("user-1", "project-1"),
    ).resolves.toBeUndefined();
    expect(db.updateUsers).toHaveBeenCalledWith({
      where: { id: "user-1", lastPlatformMcpProjectId: "project-1" },
      data: { lastPlatformMcpProjectId: null },
    });
  });

  it("persists a newly selected project", async () => {
    db.updateUser.mockResolvedValue({});
    await rememberPlatformMcpProject("user-1", "project-2");
    expect(db.updateUser).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastPlatformMcpProjectId: "project-2" },
    });
  });
});
