import type { EndpointManifest } from "@mcpops/shared";

export type ManifestState = {
  endpoint: { name: string; slug: string; description: string; kind: "mcp" | "http" };
  functions: Array<{
    id: string;
    name: string;
    enabled: boolean;
    riskLevel: string;
    requiredPermissions: unknown;
  }>;
  mcpBindings: Array<{
    id: string;
    toolName: string;
    functionId: string;
    title: string;
    description: string;
    enabled: boolean;
  }>;
  httpBindings: Array<{
    id: string;
    method: string;
    path: string;
    functionId: string;
    enabled: boolean;
  }>;
  authPolicies: Array<{ id: string; name: string }>;
};

export type ManifestPlan = ReturnType<typeof buildManifestPlan>;

export function buildManifestPlan(state: ManifestState, manifest: EndpointManifest) {
  const errors: Array<{ code: string; target: string; message: string }> = [];
  const functionsByName = new Map(state.functions.map((fn) => [fn.name, fn]));
  const policiesByName = new Map(
    state.authPolicies.map((policy) => [policy.name, policy]),
  );
  if (manifest.endpoint.kind !== state.endpoint.kind)
    errors.push({
      code: "ENDPOINT_KIND_MISMATCH",
      target: "endpoint.kind",
      message: "A manifest cannot change the endpoint protocol.",
    });
  for (const fn of manifest.functions)
    if (!functionsByName.has(fn.name))
      errors.push({
        code: "MISSING_FUNCTION_SOURCE",
        target: fn.name,
        message:
          "Manifest import cannot create executable source. Create this function from the editor or a reviewed template first.",
      });
  if (manifest.auth && !policiesByName.has(manifest.auth.policy))
    errors.push({
      code: "AUTH_POLICY_NOT_FOUND",
      target: manifest.auth.policy,
      message: "The endpoint authentication policy does not exist in this project.",
    });
  for (const tool of manifest.mcp?.tools ?? [])
    if (!functionsByName.has(tool.function))
      errors.push({
        code: "BINDING_FUNCTION_NOT_FOUND",
        target: tool.toolName,
        message: `Function '${tool.function}' does not exist.`,
      });
  for (const route of manifest.http?.routes ?? []) {
    if (!functionsByName.has(route.function))
      errors.push({
        code: "BINDING_FUNCTION_NOT_FOUND",
        target: `${route.method} ${route.path}`,
        message: `Function '${route.function}' does not exist.`,
      });
  }
  const desiredTools = new Map(
    (manifest.mcp?.tools ?? []).map((tool) => [tool.toolName, tool]),
  );
  const currentTools = new Map(
    state.mcpBindings.map((binding) => [binding.toolName, binding]),
  );
  const desiredRoutes = new Map(
    (manifest.http?.routes ?? []).map((route) => [
      `${route.method} ${route.path}`,
      route,
    ]),
  );
  const currentRoutes = new Map(
    state.httpBindings.map((binding) => [`${binding.method} ${binding.path}`, binding]),
  );
  const changes = [
    {
      operation: "update",
      resource: "endpoint",
      key: state.endpoint.slug,
      before: state.endpoint,
      after: {
        name: manifest.endpoint.name,
        slug: manifest.endpoint.slug,
        description: manifest.endpoint.description,
        runtimeVersion: manifest.endpoint.runtimeVersion,
        runtime: manifest.endpoint.runtime,
        network: manifest.endpoint.network,
        authPolicy: manifest.auth?.policy ?? null,
      },
    },
    ...manifest.functions
      .filter((fn) => functionsByName.has(fn.name))
      .map((fn) => ({
        operation: "update",
        resource: "function",
        key: fn.name,
        before: functionsByName.get(fn.name),
        after: fn,
      })),
    ...[...desiredTools].map(([key, value]) => ({
      operation: currentTools.has(key) ? "update" : "create",
      resource: "mcp_binding",
      key,
      before: currentTools.get(key),
      after: value,
    })),
    ...[...currentTools]
      .filter(([key]) => !desiredTools.has(key))
      .map(([key, value]) => ({
        operation: "delete",
        resource: "mcp_binding",
        key,
        before: value,
        after: null,
      })),
    ...[...desiredRoutes].map(([key, value]) => ({
      operation: currentRoutes.has(key) ? "update" : "create",
      resource: "http_binding",
      key,
      before: currentRoutes.get(key),
      after: value,
    })),
    ...[...currentRoutes]
      .filter(([key]) => !desiredRoutes.has(key))
      .map(([key, value]) => ({
        operation: "delete",
        resource: "http_binding",
        key,
        before: value,
        after: null,
      })),
  ];
  return {
    valid: errors.length === 0,
    errors,
    changes,
    summary: {
      creates: changes.filter((change) => change.operation === "create").length,
      updates: changes.filter((change) => change.operation === "update").length,
      deletes: changes.filter((change) => change.operation === "delete").length,
    },
  };
}
