function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function resolveDevelopmentRuntimeEnvironment(
  environmentVariables: unknown,
  endpointConfig: unknown,
  activeConfig: unknown,
  activeSnapshot: unknown,
): Record<string, unknown> {
  const endpoint = record(endpointConfig);
  const active = record(activeConfig);
  const snapshot = record(activeSnapshot);
  const endpointEnvironment = record(
    endpoint.env ?? active.env ?? snapshot.env,
  );
  return {
    ...record(environmentVariables),
    ...endpointEnvironment,
  };
}
