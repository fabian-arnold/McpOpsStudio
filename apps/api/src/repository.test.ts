import { describe, expect, it } from "vitest";
import {
  functionIdentifierWhere,
  endpointIdentifierWhere,
  endpointListWhere,
} from "./repository.js";

describe("route identifier filters", () => {
  it("uses UUID fields only for valid UUID values", () => {
    const id = "6a23b764-da5f-4849-b5f3-9dc6a6a711d4";
    expect(endpointIdentifierWhere(id)).toEqual({ id });
    expect(functionIdentifierWhere(id)).toEqual({ id });
  });

  it("maps friendly identifiers without passing them to UUID columns", () => {
    expect(endpointIdentifierWhere("customer-operations")).toEqual({
      slug: "customer-operations",
    });
    expect(functionIdentifierWhere("search_customers")).toEqual({
      OR: [{ slug: "search_customers" }, { name: "search_customers" }],
    });
  });

  it("keeps endpoint filters inside the authenticated project scope", () => {
    expect(
      endpointListWhere("org-session", {
        environmentId: "environment",
        status: "deployed",
        q: "customer",
      }),
    ).toMatchObject({
      projectId: "org-session",
      environmentId: "environment",
      status: "deployed",
      OR: expect.any(Array),
    });
  });
});
