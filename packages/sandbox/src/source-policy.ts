import ts from "typescript";

const forbiddenIdentifiers = new Map([
  ["process", "Process access is not available"],
  ["global", "Host global access is not available"],
  ["globalThis", "Host global access is not available"],
  ["fetch", "Use ctx.http for network access"],
  ["XMLHttpRequest", "Use ctx.http for network access"],
  ["WebSocket", "Use ctx.http for network access"],
  ["Deno", "Host runtime access is not available"],
  ["Bun", "Host runtime access is not available"],
]);

export function validateSourcePolicy(code: string, label: string): void {
  const source = ts.createSourceFile(
    `${label}.ts`,
    code,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );

  visit(source);

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
        reject("Dynamic imports are not available");
      if (ts.isIdentifier(node.expression)) {
        if (node.expression.text === "require")
          reject("CommonJS require is not available");
        if (["eval", "Function"].includes(node.expression.text))
          reject("Dynamic code generation is not available");
      }
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Function"
    )
      reject("Dynamic code generation is not available");
    if (ts.isImportEqualsDeclaration(node))
      reject("CommonJS imports are not available");
    if (ts.isIdentifier(node) && isRuntimeReference(node)) {
      const message = forbiddenIdentifiers.get(node.text);
      if (message) reject(message);
    }
    ts.forEachChild(node, visit);
  }

  function reject(message: string): never {
    throw new Error(`${label}: ${message}`);
  }
}

function isRuntimeReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node)
  )
    return false;
  return true;
}
