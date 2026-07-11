import { createHash } from "node:crypto";
import { build, type Plugin } from "esbuild";
import { platformModuleSources } from "@mcpops/platform-modules";

export type ProjectLibrarySource = { importPath: string; code: string; version: number };
export type BundleRequest = { code: string; projectLibraries?: ProjectLibrarySource[] };
export type BundleResult = { compiledCode: string; sourceMap: string; checksum: string; imports: string[] };

const forbiddenSyntax: ReadonlyArray<[RegExp, string]> = [
  [/\brequire\s*\(/, "CommonJS require is not available"],
  [/\bimport\s*\(/, "Dynamic imports are not available"],
  [/\bprocess\b/, "Process access is not available"],
  [/\b(?:eval|Function)\s*\(/, "Dynamic code generation is not available"],
  [/\b(?:fetch|XMLHttpRequest|WebSocket)\b/, "Use ctx.http for network access"],
  [/\b(?:Deno|Bun)\b/, "Host runtime access is not available"]
];

export async function bundleFunction(request: BundleRequest): Promise<BundleResult> {
  validateSource(request.code, "function");
  const libraryMap = new Map((request.projectLibraries ?? []).map((library) => [library.importPath, library]));
  for (const library of libraryMap.values()) {
    if (!library.importPath.startsWith("@mcpops/lib/")) throw new Error(`Invalid project library path: ${library.importPath}`);
    validateSource(library.code, library.importPath);
  }
  const imports = new Set<string>();
  const controlledModules: Plugin = {
    name: "mcpops-controlled-modules",
    setup(buildApi) {
      buildApi.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return;
        imports.add(args.path);
        if (Object.hasOwn(platformModuleSources, args.path) || libraryMap.has(args.path)) return { path: args.path, namespace: "mcpops" };
        return { errors: [{ text: `Import '${args.path}' is not allowed. Only reviewed @mcpops/shared/* and @mcpops/lib/* modules are available.` }] };
      });
      buildApi.onLoad({ filter: /.*/, namespace: "mcpops" }, (args) => ({
        contents: platformModuleSources[args.path] ?? libraryMap.get(args.path)?.code ?? "",
        loader: "ts"
      }));
    }
  };
  const result = await build({
    stdin: { contents: request.code, loader: "ts", sourcefile: "function.ts", resolveDir: "/mcpops" },
    bundle: true, write: false, outfile: "function.js", format: "esm", platform: "neutral", target: "es2022", sourcemap: "external",
    legalComments: "none", treeShaking: true, plugins: [controlledModules]
  });
  const js = result.outputFiles.find((file) => file.path.endsWith(".js"));
  const map = result.outputFiles.find((file) => file.path.endsWith(".js.map"));
  if (!js) throw new Error("esbuild did not produce JavaScript output");
  const compiledCode = js.text;
  return { compiledCode, sourceMap: map?.text ?? "", checksum: createHash("sha256").update(compiledCode).digest("hex"), imports: [...imports].sort() };
}

function validateSource(code: string, label: string): void {
  for (const [pattern, message] of forbiddenSyntax) if (pattern.test(code)) throw new Error(`${label}: ${message}`);
}
