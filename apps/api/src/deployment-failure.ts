export type FunctionSource = {
  id: string;
  name: string;
  slug: string;
  version: number;
  code: string;
};

export function inferFailedFunction(
  message: string | undefined,
  functions: FunctionSource[],
): FunctionSource | undefined {
  if (!message) return undefined;
  const location = message.match(
    /(?:^|[/\\])function\.ts:(\d+):(\d+):[\s\S]*?found "([^"]+)"/,
  );
  if (!location) return undefined;
  const line = Number(location[1]);
  const column = Number(location[2]);
  const token = location[3];
  if (!Number.isInteger(line) || !Number.isInteger(column) || !token) return;
  const matches = functions.filter((fn) => {
    const sourceLine = fn.code.split(/\r?\n/)[line - 1];
    return (
      sourceLine?.slice(column, column + token.length) === token ||
      sourceLine?.slice(column - 1, column - 1 + token.length) === token
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}
