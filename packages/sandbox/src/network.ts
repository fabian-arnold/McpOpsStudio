import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import {
  SafeRuntimeError,
  type HttpRequest,
  type HttpResponse,
  type RestrictedHttpClient,
} from "@mcpops/runtime-sdk";

export type NetworkPolicy = {
  allowedHosts: string[];
  allowedMethods: string[];
  allowedPorts: number[];
  maxResponseBytes: number;
  allowPrivateHosts?: string[];
  allowInsecureTlsHosts?: string[];
};
const metadataHosts = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.azure.com",
]);

export function isPrivateAddress(address: string): boolean {
  if (
    address === "::1" ||
    address === "0:0:0:0:0:0:0:1" ||
    address.startsWith("fe80:") ||
    address.startsWith("fc") ||
    address.startsWith("fd")
  )
    return true;
  if (isIP(address) !== 4) return false;
  const parts = address.split(".").map(Number);
  const [a = 0, b = 0] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export async function assertAllowedUrl(
  rawUrl: string,
  policy: NetworkPolicy,
  requestId: string,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeRuntimeError({
      code: "VALIDATION_ERROR",
      message: "The outbound URL is invalid.",
      requestId,
    });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new SafeRuntimeError({
      code: "FORBIDDEN",
      message: "The outbound URL scheme is not allowed.",
      requestId,
    });
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const hostAllowed = hostMatchesAllowlist(host, policy.allowedHosts);
  if (!hostAllowed || metadataHosts.has(host))
    throw new SafeRuntimeError({
      code: "FORBIDDEN",
      message: "The outbound host is not allowed.",
      requestId,
    });
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!policy.allowedPorts.includes(port))
    throw new SafeRuntimeError({
      code: "FORBIDDEN",
      message: "The outbound port is not allowed.",
      requestId,
    });
  let addresses: { address: string }[];
  try {
    addresses = isIP(host)
      ? [{ address: host }]
      : await lookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw connectionError(url, "dns", error, requestId);
  }
  if (
    !addresses.length ||
    !privateResolutionAllowed(
      host,
      addresses.map(({ address }) => address),
      policy,
    )
  )
    throw new SafeRuntimeError({
      code: "FORBIDDEN",
      message: "Private and metadata network addresses are blocked.",
      requestId,
    });
  return url;
}

export function privateResolutionAllowed(
  host: string,
  addresses: readonly string[],
  policy: NetworkPolicy,
): boolean {
  const hardBlocked = new Set(["169.254.169.254", "100.100.100.200"]);
  if (addresses.some((address) => hardBlocked.has(address))) return false;
  const explicitlyAllowed = (policy.allowPrivateHosts ?? []).includes(host);
  return addresses.every((address) => !isPrivateAddress(address) || explicitlyAllowed);
}

export function hostMatchesAllowlist(
  hostname: string,
  allowedHosts: readonly string[],
): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((entry) => {
    const allowed = entry.toLowerCase().replace(/\.$/, "");
    return (
      allowed === host ||
      (allowed.startsWith("*.") &&
        host.endsWith(allowed.slice(1)) &&
        host !== allowed.slice(2))
    );
  });
}

export class PolicyHttpClient implements RestrictedHttpClient {
  constructor(
    private readonly policy: NetworkPolicy,
    private readonly requestId: string,
    private readonly signal?: AbortSignal,
  ) {}
  async request(request: HttpRequest): Promise<HttpResponse> {
    const method = (request.method ?? "GET").toUpperCase();
    if (!this.policy.allowedMethods.includes(method))
      throw new SafeRuntimeError({
        code: "FORBIDDEN",
        message: "The outbound HTTP method is not allowed.",
        requestId: this.requestId,
      });
    let url = await assertAllowedUrl(request.url, this.policy, this.requestId);
    for (const [key, value] of Object.entries(request.query ?? {}))
      if (value !== undefined && value !== null)
        url.searchParams.append(key, String(value));
    const timeout = AbortSignal.timeout(Math.min(request.timeoutMs ?? 15_000, 30_000));
    const signal = this.signal ? AbortSignal.any([this.signal, timeout]) : timeout;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      let dispatcher: Agent | undefined;
      try {
        dispatcher = insecureTlsDispatcher(request, url, this.policy, this.requestId);
        const init: RequestInit = {
          method,
          redirect: "manual",
          signal,
          ...(request.headers ? { headers: request.headers } : {}),
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        };
        const response = dispatcher
          ? await undiciFetch(url, {
              ...init,
              dispatcher,
            } as Parameters<typeof undiciFetch>[1])
          : await fetch(url, init);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location || redirects === 3)
            throw new SafeRuntimeError({
              code: "UPSTREAM_ERROR",
              message: "The upstream redirect could not be followed.",
              requestId: this.requestId,
            });
          url = await assertAllowedUrl(
            new URL(location, url).toString(),
            this.policy,
            this.requestId,
          );
          continue;
        }
        const declaredSize = Number(response.headers.get("content-length") ?? 0);
        if (declaredSize > this.policy.maxResponseBytes) throw tooLarge(this.requestId);
        const bytes = await readLimited(
          response as unknown as Response,
          this.policy.maxResponseBytes,
          this.requestId,
        );
        const text = new TextDecoder().decode(bytes);
        let data: unknown = text;
        if ((response.headers.get("content-type") ?? "").includes("json") && text) {
          try {
            data = JSON.parse(text);
          } catch {
            /* sanitized plain text */
          }
        }
        if (!response.ok)
          throw new SafeRuntimeError({
            code: "UPSTREAM_ERROR",
            message: "The upstream service returned an error.",
            requestId: this.requestId,
            retryable: response.status >= 500,
          });
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          headers[name] = value;
        });
        return { status: response.status, headers, data };
      } catch (error) {
        if (error instanceof SafeRuntimeError) throw error;
        if (signal.aborted)
          throw connectionError(url, "timeout", error, this.requestId);
        throw connectionError(url, connectionPhase(error), error, this.requestId);
      } finally {
        await dispatcher?.close();
      }
    }
    throw new SafeRuntimeError({
      code: "UPSTREAM_ERROR",
      message: "The upstream request failed.",
      requestId: this.requestId,
    });
  }
}

function insecureTlsDispatcher(
  request: HttpRequest,
  url: URL,
  policy: NetworkPolicy,
  requestId: string,
): Agent | undefined {
  if (request.tls?.rejectUnauthorized !== false) return undefined;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:")
    throw new SafeRuntimeError({
      code: "VALIDATION_ERROR",
      message: "TLS settings can only be used with HTTPS URLs.",
      requestId,
    });
  if (!(policy.allowInsecureTlsHosts ?? []).includes(host))
    throw new SafeRuntimeError({
      code: "FORBIDDEN",
      message: "TLS verification cannot be disabled for this outbound host.",
      requestId,
    });
  return new Agent({ connect: { rejectUnauthorized: false } });
}

function connectionError(
  url: URL,
  phase: "dns" | "connect" | "tls" | "timeout",
  error: unknown,
  requestId: string,
): SafeRuntimeError {
  const cause = safeCause(error, phase);
  return new SafeRuntimeError({
    code: phase === "timeout" ? "TIMEOUT" : "UPSTREAM_ERROR",
    message:
      phase === "timeout"
        ? "The upstream request timed out."
        : "The upstream service could not be reached.",
    requestId,
    retryable: true,
    diagnostic: {
      code: "HTTP_CONNECT_FAILED",
      host: url.hostname.toLowerCase(),
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      phase,
      cause,
    },
  });
}

function connectionPhase(error: unknown): "dns" | "connect" | "tls" {
  const code = errorCode(error);
  if (["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "ENODATA"].includes(code)) return "dns";
  if (code.startsWith("CERT_") || code.includes("TLS") || code.includes("SSL"))
    return "tls";
  return "connect";
}

function safeCause(error: unknown, phase: string): string {
  const code = errorCode(error);
  if (code.startsWith("CERT_") || code.includes("SELF_SIGNED")) return "CERT_UNTRUSTED";
  const allowed = new Set([
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ETIMEDOUT",
  ]);
  return allowed.has(code)
    ? code
    : phase === "timeout"
      ? "TIMEOUT"
      : "CONNECTION_FAILED";
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = error as { code?: unknown; cause?: unknown };
  if (typeof value.code === "string") return value.code.toUpperCase();
  return value.cause === error ? "" : errorCode(value.cause);
}

async function readLimited(
  response: Response,
  limit: number,
  requestId: string,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw tooLarge(requestId);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
function tooLarge(requestId: string): SafeRuntimeError {
  return new SafeRuntimeError({
    code: "UPSTREAM_ERROR",
    message: "The upstream response exceeded the configured size limit.",
    requestId,
  });
}
