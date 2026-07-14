export type CallableFunction = {
  id: string;
  slug: string;
  name: string;
  versions: Array<{ code: string }>;
};

/** Resolves immutable internal calls. Dynamic targets are intentionally rejected. */
export function resolveFunctionCallGraph<T extends CallableFunction>(
  available: T[],
  entryFunctionIds: ReadonlySet<string>,
): {
  functions: T[];
  calls: Array<{
    callerFunctionId: string;
    calleeFunctionId: string;
    calleeSlug: string;
  }>;
} {
  const byId = new Map(available.map((fn) => [fn.id, fn]));
  const bySlug = new Map(available.map((fn) => [fn.slug, fn]));
  const callsById = new Map<string, T[]>();
  const literalCall =
    /\bctx\s*\.\s*functions\s*\.\s*call\s*\(\s*(["'])([a-z][a-z0-9_-]{0,119})\1/g;
  const anyCall = /\bctx\s*\.\s*functions\s*\.\s*call\s*\(/g;

  for (const fn of available) {
    const code = fn.versions[0]?.code ?? "";
    const literalStarts = new Set<number>();
    const callees: T[] = [];
    for (const match of code.matchAll(literalCall)) {
      literalStarts.add(match.index ?? -1);
      const calleeSlug = match[2];
      if (!calleeSlug) continue;
      const callee = bySlug.get(calleeSlug);
      if (!callee)
        throw new Error(
          `Function ${fn.slug} calls missing or disabled function '${calleeSlug}'`,
        );
      callees.push(callee);
    }
    for (const match of code.matchAll(anyCall))
      if (!literalStarts.has(match.index ?? -1))
        throw new Error(
          `Function ${fn.slug} uses a dynamic ctx.functions.call target; use a literal project function slug`,
        );
    callsById.set(fn.id, callees);
  }

  const selected = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    const fn = byId.get(id);
    if (!fn)
      throw new Error(
        `A binding references a missing or disabled project function: ${id}`,
      );
    if (visiting.has(id))
      throw new Error(
        `Internal function call cycle detected: ${[...path, fn.slug].join(" -> ")}`,
      );
    if (visited.has(id)) {
      selected.add(id);
      return;
    }
    visiting.add(id);
    selected.add(id);
    for (const callee of callsById.get(id) ?? []) visit(callee.id, [...path, fn.slug]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of entryFunctionIds) visit(id, []);

  return {
    functions: available.filter((fn) => selected.has(fn.id)),
    calls: available.flatMap((caller) =>
      selected.has(caller.id)
        ? (callsById.get(caller.id) ?? [])
            .filter((callee) => selected.has(callee.id))
            .map((callee) => ({
              callerFunctionId: caller.id,
              calleeFunctionId: callee.id,
              calleeSlug: callee.slug,
            }))
        : [],
    ),
  };
}
