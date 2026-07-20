import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@mcpops/db", () => ({
  prisma: {
    functionExecution: {
      findMany: db.findMany,
      updateMany: db.updateMany,
    },
    $transaction: db.transaction,
  },
}));

import {
  recoverStaleExecutions,
  STALE_EXECUTION_AFTER_MS,
  staleExecutionCutoff,
} from "./execution-repository.js";

describe("running execution recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.updateMany.mockResolvedValue({ count: 1 });
    db.transaction.mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
  });

  it("marks an abandoned execution failed with a safe error", async () => {
    const now = Date.UTC(2026, 6, 20, 12, 0, 0);
    const createdAt = new Date(now - 120_000);
    db.findMany.mockResolvedValue([{ id: "execution-1", createdAt }]);

    await expect(recoverStaleExecutions(now)).resolves.toBe(1);
    expect(staleExecutionCutoff(now).getTime()).toBe(now - STALE_EXECUTION_AFTER_MS);
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: "execution-1", status: "running" },
      data: {
        status: "error",
        durationMs: 120_000,
        error: {
          code: "INTERNAL_ERROR",
          message: "The worker stopped before execution completed.",
        },
        heartbeatAt: new Date(now),
        completedAt: new Date(now),
      },
    });
  });
});
