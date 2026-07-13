import { describe, expect, it } from "vitest";
import {
  bindingMapLayoutSchema,
  bindingMapNodeIds,
} from "./binding-map-layout.js";

const endpointId = "00000000-0000-4000-8000-000000000001";
const bindingId = "00000000-0000-4000-8000-000000000002";
const functionId = "00000000-0000-4000-8000-000000000003";

describe("binding map layout", () => {
  it("accepts finite bounded positions for typed nodes", () => {
    expect(
      bindingMapLayoutSchema.parse({
        nodes: [
          { id: `endpoint:${endpointId}`, x: 20, y: 30 },
          { id: `binding:${bindingId}`, x: 5000, y: 0 },
          { id: `function:${functionId}`, x: 400, y: 200 },
        ],
      }).nodes,
    ).toHaveLength(3);
  });

  it("rejects unknown node kinds and out-of-range coordinates", () => {
    expect(() =>
      bindingMapLayoutSchema.parse({
        nodes: [{ id: `workflow:${endpointId}`, x: -1, y: 6000 }],
      }),
    ).toThrow();
  });

  it("builds the allowlist only from project-scoped records", () => {
    const ids = bindingMapNodeIds(
      [
        {
          id: endpointId,
          mcpToolBindings: [{ id: bindingId }],
          httpRouteBindings: [],
        },
      ],
      [{ id: functionId }],
    );
    expect(ids).toEqual(
      new Set([
        `endpoint:${endpointId}`,
        `binding:${bindingId}`,
        `function:${functionId}`,
      ]),
    );
  });
});
