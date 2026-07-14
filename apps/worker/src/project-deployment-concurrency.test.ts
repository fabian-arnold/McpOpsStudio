import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  status: "building",
  completedAt: null as Date | null,
  audits: 0,
}));

const endpointDeployment = {
  id: "deployment-1",
  endpointId: "endpoint-1",
  version: 1,
  checksum: "artifact-checksum",
  status: "deploying",
  snapshot: { schemaVersion: 1 },
  endpoint: { id: "endpoint-1", name: "Endpoint", slug: "endpoint", kind: "mcp" },
};

const transaction = {
  projectDeployment: {
    async findUnique() {
      return {
        id: "project-deployment-1",
        projectId: "project-1",
        environmentId: "environment-1",
        version: 1,
        status: state.status,
        completedAt: state.completedAt,
        endpointDeployments: [endpointDeployment],
      };
    },
    async updateMany({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) {
      if (where.id === "project-deployment-1" && where.completedAt === null) {
        const allowed = (where.status as { in?: string[] } | undefined)?.in;
        if (allowed && !allowed.includes(state.status)) return { count: 0 };
        if (state.completedAt) return { count: 0 };
        if (typeof data.status === "string") state.status = data.status;
        if (data.completedAt instanceof Date) state.completedAt = data.completedAt;
        return { count: 1 };
      }
      return { count: 0 };
    },
    async update({ data }: { data: { status: string; completedAt: Date } }) {
      state.status = data.status;
      state.completedAt = data.completedAt;
    },
  },
  environment: { async update() {} },
  runtimeEndpoint: {
    async findUniqueOrThrow() {
      return { activeDeploymentId: null };
    },
    async update() {},
  },
  deployment: { async update() {} },
  auditEvent: {
    async create() {
      state.audits += 1;
    },
  },
};

vi.mock("@mcpops/db", () => ({
  prisma: {
    async $transaction(callback: (tx: typeof transaction) => Promise<void>) {
      return callback(transaction);
    },
  },
}));

import { finalizeProjectDeployment } from "./project-deployment.js";

describe("concurrent project finalization", () => {
  beforeEach(() => {
    state.status = "building";
    state.completedAt = null;
    state.audits = 0;
  });

  it("claims activation once and emits one audit event", async () => {
    await Promise.all([
      finalizeProjectDeployment("project-deployment-1"),
      finalizeProjectDeployment("project-deployment-1"),
    ]);

    expect(state.status).toBe("active");
    expect(state.completedAt).toBeInstanceOf(Date);
    expect(state.audits).toBe(1);
  });
});
