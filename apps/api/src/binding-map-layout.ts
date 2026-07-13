import { z } from "zod";

export const bindingMapLayoutSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^(endpoint|binding|function):[0-9a-f-]{36}$/i),
            x: z.number().finite().min(0).max(5000),
            y: z.number().finite().min(0).max(5000),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict();

export function bindingMapNodeIds(
  endpoints: Array<{
    id: string;
    mcpToolBindings: Array<{ id: string }>;
    httpRouteBindings: Array<{ id: string }>;
  }>,
  functions: Array<{ id: string }>,
) {
  return new Set([
    ...endpoints.map((endpoint) => `endpoint:${endpoint.id}`),
    ...endpoints.flatMap((endpoint) => [
      ...endpoint.mcpToolBindings.map((binding) => `binding:${binding.id}`),
      ...endpoint.httpRouteBindings.map((binding) => `binding:${binding.id}`),
    ]),
    ...functions.map((fn) => `function:${fn.id}`),
  ]);
}
