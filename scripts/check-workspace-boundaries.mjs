import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function checkWorkspaceBoundaries(workspaceRoot = root) {
  const workspaces = await loadWorkspaces(workspaceRoot);
  const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  const violations = [];
  const graph = new Map(workspaces.map((workspace) => [workspace.name, new Set()]));

  for (const workspace of workspaces) {
    const declared = new Set([
      ...Object.keys(workspace.manifest.dependencies ?? {}),
      ...Object.keys(workspace.manifest.devDependencies ?? {}),
      ...Object.keys(workspace.manifest.peerDependencies ?? {}),
    ]);
    for (const file of await sourceFiles(workspace.directory)) {
      const source = await readFile(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        const featureViolation = validateFeatureImport(
          path.relative(workspaceRoot, file).replaceAll("\\", "/"),
          specifier,
        );
        if (featureViolation) violations.push(featureViolation);
        const targetName = [...byName.keys()]
          .sort((left, right) => right.length - left.length)
          .find((name) => specifier === name || specifier.startsWith(`${name}/`));
        if (!targetName || targetName === workspace.name) continue;
        const target = byName.get(targetName);
        graph.get(workspace.name).add(targetName);
        if (!declared.has(targetName))
          violations.push(
            `${relative(file)} imports undeclared workspace ${targetName}`,
          );
        if (workspace.kind === "package" && target.kind === "app")
          violations.push(
            `${relative(file)} makes a reusable package depend on app ${targetName}`,
          );
        if (workspace.kind === "app" && target.kind === "app")
          violations.push(
            `${relative(file)} makes one deployable app depend on ${targetName}`,
          );
        if (
          specifier !== targetName &&
          !isExported(target.manifest.exports, specifier.slice(targetName.length))
        )
          violations.push(`${relative(file)} deep-imports private path ${specifier}`);
      }
    }
  }
  for (const cycle of findCycles(graph))
    violations.push(`workspace dependency cycle: ${cycle}`);
  return violations;

  function relative(file) {
    return path.relative(workspaceRoot, file).replaceAll("\\", "/");
  }
}

export function validateFeatureImport(source, specifier) {
  const owner = source.match(/^apps\/web\/features\/([^/]+)\//)?.[1];
  const target = specifier.match(/^@\/features\/([^/]+)(\/.*)?$/);
  if (!owner || !target || owner === target[1] || !target[2]) return;
  return `${source} deep-imports feature ${target[1]}; use its public entrypoint`;
}

async function loadWorkspaces(workspaceRoot) {
  const result = [];
  for (const kind of ["apps", "packages"]) {
    const parent = path.join(workspaceRoot, kind);
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(parent, entry.name);
      const manifest = JSON.parse(
        await readFile(path.join(directory, "package.json"), "utf8"),
      );
      result.push({
        name: manifest.name,
        directory,
        manifest,
        kind: kind === "apps" ? "app" : "package",
      });
    }
  }
  return result;
}

async function sourceFiles(directory) {
  return collect(directory);
}

async function collect(directory) {
  if (!(await exists(directory))) return [];
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", ".next", ".turbo", "coverage"].includes(entry.name))
      continue;
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await collect(item)));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) output.push(item);
  }
  return output;
}

async function exists(file) {
  try {
    await readdir(file);
    return true;
  } catch {
    return false;
  }
}

export function importSpecifiers(source) {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const specifiers = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      specifiers.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    )
      specifiers.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return specifiers;
}

function isExported(exportsField, suffix) {
  if (!suffix) return true;
  if (!exportsField || typeof exportsField !== "object") return false;
  const requested = `.${suffix}`;
  return Object.keys(exportsField).some(
    (key) =>
      key === requested ||
      (key.endsWith("/*") && requested.startsWith(key.slice(0, -1))),
  );
}

export function findCycles(graph) {
  const cycles = new Set();
  const visiting = [];
  const visited = new Set();
  const visit = (node) => {
    const index = visiting.indexOf(node);
    if (index >= 0) {
      cycles.add([...visiting.slice(index), node].join(" -> "));
      return;
    }
    if (visited.has(node)) return;
    visiting.push(node);
    for (const target of graph.get(node) ?? []) visit(target);
    visiting.pop();
    visited.add(node);
  };
  for (const node of graph.keys()) visit(node);
  return [...cycles].sort();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const violations = await checkWorkspaceBoundaries();
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else console.log("Workspace dependency boundaries are valid.");
}
