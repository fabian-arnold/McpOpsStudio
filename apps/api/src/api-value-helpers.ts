export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function deploymentFailureFunctions(metadata: Record<string, unknown>) {
  const rows = arrayRecords(metadata.functions);
  if (
    !rows.length &&
    typeof metadata.functionId === "string" &&
    typeof metadata.functionName === "string"
  )
    rows.push(metadata);
  return rows.flatMap((fn) =>
    typeof fn.functionId === "string" && typeof fn.functionName === "string"
      ? [
          {
            id: fn.functionId,
            name: fn.functionName,
            slug: typeof fn.functionSlug === "string" ? fn.functionSlug : undefined,
            version:
              typeof fn.functionVersion === "number" ? fn.functionVersion : undefined,
          },
        ]
      : [],
  );
}
export function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
export function promoteEndpointSnapshot(
  value: unknown,
  environment: { id: string; slug: string; name: string; variables: unknown },
  connections: ReadonlyMap<string, { id: string; secretId: string }>,
): Record<string, unknown> {
  const snapshot = JSON.parse(JSON.stringify(record(value))) as Record<string, unknown>;
  snapshot.environment = {
    id: environment.id,
    slug: environment.slug,
    name: environment.name,
  };
  snapshot.env = record(environment.variables);
  snapshot.reviewedQueries = arrayRecords(snapshot.reviewedQueries).map((query) => {
    const connection = record(query.connection);
    const name = typeof connection.name === "string" ? connection.name : "";
    const productionConnection = connections.get(name);
    return productionConnection
      ? {
          ...query,
          connection: {
            ...connection,
            id: productionConnection.id,
            secretId: productionConnection.secretId,
          },
        }
      : query;
  });
  return snapshot;
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
