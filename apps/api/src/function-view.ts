type EndpointReference = {
  id: string;
  name: string;
  slug: string;
  kind: "mcp" | "http";
};

type McpBindingRow = {
  id: string;
  functionId: string;
  toolName: string;
  title: string;
  description: string;
  enabled: boolean;
  endpoint: EndpointReference;
};

type HttpBindingRow = {
  id: string;
  functionId: string;
  method: string;
  path: string;
  inputMapping?: unknown;
  responseMapping?: unknown;
  enabled: boolean;
  endpoint: EndpointReference;
};

export function normalizeFunctionBindings(
  mcpBindings: readonly McpBindingRow[],
  httpBindings: readonly HttpBindingRow[],
) {
  return {
    mcpBindings: mcpBindings.map((binding) => ({
      id: binding.id,
      functionId: binding.functionId,
      toolName: binding.toolName,
      title: binding.title,
      description: binding.description,
      enabled: binding.enabled,
      endpoint: binding.endpoint,
    })),
    httpBindings: httpBindings.map((binding) => ({
      id: binding.id,
      functionId: binding.functionId,
      method: binding.method,
      path: binding.path,
      inputMapping: binding.inputMapping ?? null,
      responseMapping: binding.responseMapping ?? null,
      enabled: binding.enabled,
      endpoint: binding.endpoint,
    })),
  };
}
