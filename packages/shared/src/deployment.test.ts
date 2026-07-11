import { describe, expect, it } from "vitest";
import { planRollback } from "./deployment.js";
describe("deployment rollback", () => {
  it("moves the active pointer only to a completed immutable snapshot", () => expect(planRollback("new", { id: "old", version: 1, status: "rolled_back" })).toEqual({ deactivateId: "new", activateId: "old", version: 1 }));
  it("rejects failed or current targets", () => { expect(() => planRollback("new", { id: "bad", version: 2, status: "failed" })).toThrow(); expect(() => planRollback("same", { id: "same", version: 2, status: "active" })).toThrow(); });
});
