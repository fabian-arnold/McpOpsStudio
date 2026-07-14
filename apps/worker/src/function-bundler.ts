import { Ajv } from "ajv";
import { bundleFunction as bundleRestrictedFunction } from "@mcpops/sandbox";

export type BuildFailure = {
  id: string;
  name: string;
  slug: string;
  version: number;
};

export function attachCurrentFunctionVersions<
  FunctionRow extends { id: string; version: number },
  VersionRow extends { functionId: string; version: number },
>(functions: FunctionRow[], versions: VersionRow[]) {
  const versionsByKey = new Map(
    versions.map((version) => [`${version.functionId}:${version.version}`, version]),
  );
  return functions.map((fn) => {
    const version = versionsByKey.get(`${fn.id}:${fn.version}`);
    return { ...fn, versions: version ? [version] : [] };
  });
}

export type BuildInput = {
  code: string;
  inputSchema: unknown;
  outputSchema: unknown;
  libraries: Array<{ importPath: string; code: string }>;
  sourcefile?: string;
};
export async function bundleFunction(
  input: BuildInput,
): Promise<{ code: string; sourceMap?: string; warnings: string[] }> {
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.compile(input.inputSchema as object);
  ajv.compile(input.outputSchema as object);
  const result = await bundleRestrictedFunction({
    code: input.code,
    sourcefile: input.sourcefile,
    projectLibraries: input.libraries.map((library) => ({
      ...library,
      version: 0,
    })),
  });
  return {
    code: result.compiledCode,
    ...(result.sourceMap ? { sourceMap: result.sourceMap } : {}),
    warnings: result.warnings,
  };
}
