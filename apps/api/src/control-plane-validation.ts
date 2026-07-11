import { isIP } from "node:net";
import { bundleFunction } from "@mcpops/sandbox";

const forbiddenLibrarySyntax: ReadonlyArray<[RegExp, string]> = [
  [/\brequire\s*\(/, "CommonJS require is not available"],
  [/\bimport\s*\(/, "Dynamic imports are not available"],
  [
    /(?:\bimport\s+[^;(]+\s+from\s*|\bexport\s+[^;(]+\s+from\s*|\brequire\s*)["']/,
    "Project libraries cannot import modules",
  ],
  [/\b(?:process|Deno|Bun)\b/, "Host process access is not available"],
  [/\b(?:fetch|XMLHttpRequest|WebSocket)\b/, "Network access is not available"],
  [/\b(?:eval|Function)\s*\(/, "Dynamic code generation is not available"],
  [
    /\b(?:node:)?(?:fs|child_process)\b/,
    "Filesystem and child-process access is not available",
  ],
];

export async function validateProjectLibrary(
  importPath: string,
  code: string,
): Promise<void> {
  for (const [pattern, message] of forbiddenLibrarySyntax)
    if (pattern.test(code))
      throw Object.assign(new Error(message), {
        statusCode: 400,
        code: "UNSAFE_LIBRARY",
      });
  try {
    await bundleFunction({
      code: `import * as library from ${JSON.stringify(importPath)}; export default async function validateLibrary() { return Object.keys(library); }`,
      projectLibraries: [{ importPath, code, version: 1 }],
    });
  } catch (error) {
    throw Object.assign(
      new Error(
        error instanceof Error ? error.message : "Library validation failed",
      ),
      { statusCode: 400, code: "INVALID_LIBRARY" },
    );
  }
}

function literalPrivateHost(host: string): boolean {
  const normalized = host.toLowerCase();
  if (
    ["localhost", "metadata.google.internal", "metadata.azure.com"].includes(
      normalized,
    ) ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  )
    return true;
  if (isIP(normalized) !== 4) return false;
  const [a = 0, b = 0] = normalized.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function networkPolicyWarnings(
  allowedHosts: string[],
  allowPrivateHosts: string[],
) {
  return allowedHosts.flatMap((host) => {
    if (host.startsWith("*."))
      return [
        {
          host,
          code: "WILDCARD_HOST",
          message: "Wildcard hosts expand the outbound trust boundary.",
        },
      ];
    if (allowPrivateHosts.includes(host))
      return [
        {
          host,
          code: "PRIVATE_HOST_ALLOWED",
          message:
            "This host may resolve privately and is explicitly allowed in the next deployment snapshot.",
        },
      ];
    if (literalPrivateHost(host))
      return [
        {
          host,
          code: "PRIVATE_HOST_BLOCKED",
          message:
            "Private address ranges remain blocked unless this exact host is explicitly allowed.",
        },
      ];
    return [];
  });
}

export function providerStatus(
  type: string,
  flags: Record<string, string | undefined> = process.env,
) {
  if (
    ["public", "api_key", "bearer_token", "basic_auth", "webhook_signature"].includes(
      type,
    )
  )
    return "enabled" as const;
  if (type === "jwt")
    return flags.ENABLE_JWT_AUTH === "true"
      ? ("enabled" as const)
      : ("deferred" as const);
  if (type === "entra_id")
    return flags.ENABLE_ENTRA_AUTH === "true"
      ? ("enabled" as const)
      : ("deferred" as const);
  return "deferred" as const;
}
