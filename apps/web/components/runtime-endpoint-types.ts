export type EndpointKind = "mcp" | "http";
export type Tab =
  | "overview"
  | "bindings"
  | "authentication"
  | "network"
  | "executions"
  | "manifest"
  | "settings";

export const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "bindings", label: "Bindings" },
  { id: "authentication", label: "Authentication" },
  { id: "network", label: "Network" },
  { id: "executions", label: "Executions" },
  { id: "manifest", label: "Manifest" },
  { id: "settings", label: "Settings" },
];
