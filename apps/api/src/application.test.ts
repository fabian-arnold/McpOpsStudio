import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./application.js";

let app: FastifyInstance | undefined;

afterEach(async () => app?.close());

describe("control-plane application composition", () => {
  it("constructs an injectable app with request IDs and public-route bypass", async () => {
    app = await createApiApplication({
      async assertScopedCursor() {},
    });
    app.get("/health", async () => ({ status: "ok" }));

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "application-test" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("application-test");
    expect(response.json()).toEqual({ status: "ok" });
  });
});
