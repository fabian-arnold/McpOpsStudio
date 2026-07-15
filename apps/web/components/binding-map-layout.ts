import type { OpsFunction } from "@/lib/types";
import {
  NODE_SIZE,
  type BindingNode,
  type Layout,
  type MapEndpoint,
  type MapCronBinding,
  type NodePosition,
} from "./binding-map-types";

export function flattenBindings(endpoints: MapEndpoint[]): BindingNode[] {
  return endpoints.flatMap((endpoint) => [
    ...endpoint.mcpToolBindings.map((binding) => ({
      id: binding.id,
      endpointId: endpoint.id,
      endpointKind: "mcp" as const,
      functionId: binding.functionId,
      label: binding.toolName,
      detail: binding.title,
      enabled: binding.enabled,
      raw: binding,
    })),
    ...endpoint.httpRouteBindings.map((binding) => ({
      id: binding.id,
      endpointId: endpoint.id,
      endpointKind: "http" as const,
      functionId: binding.functionId,
      label: `${binding.method} ${binding.path}`,
      detail: binding.path,
      enabled: binding.enabled,
      raw: binding,
    })),
  ]);
}

export function buildDefaultLayout(
  endpoints: MapEndpoint[],
  functions: OpsFunction[],
  cronBindings: MapCronBinding[] = [],
): Layout {
  const layout: Layout = {};
  let endpointCursor = 90;
  for (const endpoint of endpoints) {
    const bindings =
      endpoint.kind === "mcp" ? endpoint.mcpToolBindings : endpoint.httpRouteBindings;
    const groupHeight = Math.max(130, bindings.length * 112);
    layout[`endpoint:${endpoint.id}`] = {
      x: 70,
      y: endpointCursor + Math.max(0, (groupHeight - NODE_SIZE.endpoint.height) / 2),
    };
    bindings.forEach((binding, index) => {
      layout[`binding:${binding.id}`] = {
        x: 500,
        y: endpointCursor + index * 112,
      };
    });
    endpointCursor += groupHeight + 70;
  }
  cronBindings.forEach((binding, index) => {
    layout[`schedule:${binding.id}`] = { x: 850, y: 90 + index * 112 };
  });
  functions.forEach((fn, index) => {
    layout[`function:${fn.id}`] = { x: 1250, y: 90 + index * 112 };
  });
  return layout;
}

export function readLayout(value: unknown): Layout {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, NodePosition] =>
        !!entry[1] &&
        typeof entry[1] === "object" &&
        !Array.isArray(entry[1]) &&
        Number.isFinite((entry[1] as NodePosition).x) &&
        Number.isFinite((entry[1] as NodePosition).y),
    ),
  );
}

export function nodeSize(id: string) {
  if (id.startsWith("endpoint:")) return NODE_SIZE.endpoint;
  if (id.startsWith("binding:")) return NODE_SIZE.binding;
  if (id.startsWith("schedule:")) return NODE_SIZE.schedule;
  return NODE_SIZE.function;
}

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
