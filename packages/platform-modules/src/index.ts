/** Reviewed source modules are bundled into user functions by the sandbox. */
export const platformModuleSources: Readonly<Record<string, string>> = Object.freeze({
  "@mcpops/shared/auth": `
    export function requirePermission(ctx, permission) {
      if (!ctx.permissions.includes(permission)) throw platformError("FORBIDDEN", "The caller does not have the required permission.", ctx.invocation.requestId);
    }
    function platformError(code, message, requestId) { const error = new Error(message); error.code = code; error.requestId = requestId; return error; }
  `,
  "@mcpops/shared/http": `
    export function safeJson(value) { return JSON.parse(JSON.stringify(value)); }
    export async function requestJson(ctx, request) { const response = await ctx.http.request(request); return response.data; }
  `,
});

export function isPlatformModule(path: string): boolean {
  return Object.hasOwn(platformModuleSources, path);
}
