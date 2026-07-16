export function snapshotHasEnabledCronBinding(
  snapshot: unknown,
  bindingId: string,
): boolean {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.slices)) return false;
  return snapshot.slices.some((slice) => {
    if (!isRecord(slice) || !Array.isArray(slice.bindings)) return false;
    return slice.bindings.some(
      (binding) =>
        isRecord(binding) && binding.id === bindingId && binding.enabled !== false,
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
