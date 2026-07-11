import { createInterface } from "node:readline";

type ExecuteMessage = { type: "execute"; moduleUrl: string; input: unknown; context: SerializedContext };
type CancelMessage = { type: "cancel"; reason?: string };
type SerializedContext = Record<string, unknown> & { secrets: Record<string, string> };
const hostProcess = process; let nextRpcId = 1; let activeAbortController: AbortController | undefined; let pendingCancellation: string | undefined;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
const lines = createInterface({ input: hostProcess.stdin, crlfDelay: Infinity });
lines.on("line", (line) => { try { handle(JSON.parse(line) as ExecuteMessage | CancelMessage | RpcResult); } catch { send({ type: "error", error: { code: "INTERNAL_ERROR", message: "Invalid executor protocol message" } }); } });

type RpcResult = { type: "rpc-result" | "rpc-error"; id: number; value?: unknown; error?: { message?: string; code?: string; requestId?: string } };
function handle(raw: ExecuteMessage | CancelMessage | RpcResult): void {
  if (raw.type === "rpc-result" || raw.type === "rpc-error") {
    const item = pending.get(raw.id); if (!item) return; pending.delete(raw.id);
    if (raw.type === "rpc-result") item.resolve(raw.value); else item.reject(Object.assign(new Error(raw.error?.message ?? "Capability failed"), raw.error)); return;
  }
  if (raw.type === "cancel") { const reason = raw.reason ?? "Function execution cancelled"; pendingCancellation = reason; activeAbortController?.abort(new DOMException(reason, "AbortError")); return; }
  if (raw.type === "execute") void execute(raw);
}
async function execute(message: ExecuteMessage): Promise<void> {
  try {
    activeAbortController = new AbortController(); if (pendingCancellation) activeAbortController.abort(new DOMException(pendingCancellation, "AbortError"));
    Object.defineProperties(globalThis, {
      process: { value: undefined, configurable: false, writable: false }, fetch: { value: undefined, configurable: false, writable: false },
      WebSocket: { value: undefined, configurable: false, writable: false }, console: { value: Object.freeze({ log() {}, info() {}, warn() {}, error() {}, debug() {} }), configurable: false, writable: false }
    });
    const imported = await import(message.moduleUrl) as { default?: unknown }; if (typeof imported.default !== "function") throw new Error("Function module must export a default handler");
    const output = await imported.default(createContext(message.context, activeAbortController.signal), message.input); send({ type: "result", output });
  } catch (error) { const value = error as { code?: string; message?: string; requestId?: string; retryable?: boolean }; send({ type: "error", error: { code: value.code, message: value.message, requestId: value.requestId, retryable: value.retryable } }); }
}
function createContext(serialized: SerializedContext, abortSignal: AbortSignal): Record<string, unknown> {
  const rpc = (operation: string, ...args: unknown[]) => new Promise<unknown>((resolve, reject) => { const id = nextRpcId++; pending.set(id, { resolve, reject }); send({ type: "rpc", id, operation, args }); });
  const storage = (tenant?: string) => ({ get: (key: string) => rpc("storage.get", key, tenant), set: (key: string, value: unknown, options?: unknown) => rpc("storage.set", key, value, options, tenant), delete: (key: string) => rpc("storage.delete", key, tenant), forTenant: (id: string) => storage(id) });
  const cache = (tenant?: string) => ({ get: (key: string) => rpc("cache.get", key, tenant), set: (key: string, value: unknown, options?: unknown) => rpc("cache.set", key, value, options, tenant), delete: (key: string) => rpc("cache.delete", key, tenant), forTenant: (id: string) => cache(id),
    getOrSet: async (key: string, producer: () => Promise<unknown>, options?: unknown) => { const existing = await rpc("cache.get", key, tenant); if (existing !== null && existing !== undefined) return existing; const value = await producer(); await rpc("cache.set", key, value, options, tenant); return value; } });
  const secretMap = Object.freeze({ ...serialized.secrets });
  return Object.freeze({ ...serialized, secrets: Object.freeze({ get(name: string) { if (!Object.hasOwn(secretMap, name)) throw Object.assign(new Error("The requested secret is not granted."), { code: "CONFIGURATION_ERROR", requestId: (serialized.invocation as { requestId: string }).requestId }); return secretMap[name]; } }),
    logger: Object.freeze(Object.fromEntries(["debug", "info", "warn", "error"].map((level) => [level, (message: string, metadata?: unknown) => { void rpc(`logger.${level}`, message, metadata); }]))),
    http: Object.freeze({ request: (request: unknown) => rpc("http.request", request) }), storage: Object.freeze(storage()), cache: Object.freeze(cache()),
    audit: Object.freeze({ write: (event: unknown) => rpc("audit.write", event) }), db: Object.freeze({ query: (request: unknown) => rpc("db.query", request) }),
    abortSignal });
}
function send(value: unknown): void { hostProcess.stdout.write(JSON.stringify(value) + "\n"); }
send({ type: "ready" });
