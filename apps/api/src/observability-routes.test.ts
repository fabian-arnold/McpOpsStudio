import { describe, expect, it } from "vitest";
import { auditView, dateWhere, executionView } from "./observability-routes.js";

describe("observability response views", () => {
  it("normalizes execution lineage, binding, and caller fields", () => {
    const createdAt = new Date("2026-07-14T12:00:00.000Z");

    expect(
      executionView({
        id: "execution-1",
        endpointId: "endpoint-1",
        functionId: "function-1",
        createdAt,
        requestId: "request-1",
        correlationId: null,
        parentExecutionId: null,
        rootExecutionId: null,
        invocationSource: "http",
        status: "success",
        durationMs: 12,
        callerIdentity: { subject: "caller@example.test" },
        input: { customerId: "123" },
        output: null,
        error: null,
        function: { name: "Find customer" },
        deployment: { version: 7 },
        functionVersion: { version: 3 },
        httpRouteBinding: { method: "GET", path: "/customers/:id" },
      }),
    ).toMatchObject({
      rootExecutionId: "execution-1",
      functionName: "Find customer",
      binding: "GET /customers/:id",
      caller: "caller@example.test",
      deploymentVersion: 7,
      functionVersion: 3,
    });
  });

  it("creates stable audit labels without inventing identifiers", () => {
    const createdAt = new Date("2026-07-14T12:00:00.000Z");

    expect(
      auditView({
        id: "audit-1",
        createdAt,
        action: "deployment.activated",
        actorType: "system",
        actorId: null,
        targetType: "deployment",
        targetId: null,
      }),
    ).toMatchObject({ actor: "system", targetId: undefined });
  });

  it("builds an inclusive date filter only for supplied bounds", () => {
    const from = new Date("2026-07-01T00:00:00.000Z");
    const to = new Date("2026-07-31T23:59:59.999Z");

    expect(dateWhere()).toEqual({});
    expect(dateWhere(from)).toEqual({ createdAt: { gte: from } });
    expect(dateWhere(undefined, to)).toEqual({ createdAt: { lte: to } });
    expect(dateWhere(from, to)).toEqual({ createdAt: { gte: from, lte: to } });
  });
});
