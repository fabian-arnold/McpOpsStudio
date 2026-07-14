import type { OpsFunction } from "@/lib/types";

export type McpBinding = {
  id: string;
  functionId: string;
  toolName: string;
  title: string;
  enabled: boolean;
};

export type HttpBinding = {
  id: string;
  functionId: string;
  method: string;
  path: string;
  enabled: boolean;
};

export type MapEndpoint = {
  id: string;
  name: string;
  slug: string;
  kind: "mcp" | "http";
  status: string;
  mcpToolBindings: McpBinding[];
  httpRouteBindings: HttpBinding[];
};

export type NodePosition = { x: number; y: number };
export type Layout = Record<string, NodePosition>;
export type BindingMapResponse = { endpoints: MapEndpoint[]; layout: unknown };
export type PendingConnection = { endpoint: MapEndpoint; fn: OpsFunction };
export type ConnectionPreviewBase = {
  pointerId: number;
  start: NodePosition;
  current: NodePosition;
};
export type ConnectionPreview = ConnectionPreviewBase &
  (
    | {
        source: "function";
        functionId: string;
        colorKind: "mcp" | "http" | undefined;
      }
    | {
        source: "endpoint";
        endpointId: string;
        colorKind: "mcp" | "http";
      }
  );

export type BindingNode = {
  id: string;
  endpointId: string;
  endpointKind: "mcp" | "http";
  functionId: string;
  label: string;
  detail: string;
  enabled: boolean;
  raw: McpBinding | HttpBinding;
};

export const NODE_SIZE = {
  endpoint: { width: 280, height: 110 },
  binding: { width: 300, height: 92 },
  function: { width: 260, height: 84 },
};
