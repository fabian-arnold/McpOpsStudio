import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { prisma } from "@mcpops/db";

export const platformScopes = ["mcpops:read", "mcpops:write", "mcpops:deploy"] as const;
export type PlatformScope = (typeof platformScopes)[number];
export const platformAccessTokenTtlSeconds = 15 * 60;
export const platformRefreshTokenTtlSeconds = 90 * 24 * 60 * 60;
export const platformMcpSessionIdleTtlSeconds = 8 * 60 * 60;

export function platformOAuthExpirations(now = new Date()) {
  return {
    accessExpiresAt: new Date(now.getTime() + platformAccessTokenTtlSeconds * 1000),
    refreshExpiresAt: new Date(now.getTime() + platformRefreshTokenTtlSeconds * 1000),
  };
}

export type OAuthRequestState = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  scopes: PlatformScope[];
  state?: string;
  resource: string;
  codeChallenge: string;
};

export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const opaqueToken = () => randomBytes(32).toString("base64url");
export const configuredPublicOrigin = (installationPublicUrl?: string) =>
  new URL(
    installationPublicUrl ??
      process.env.PUBLIC_CONTROL_PLANE_URL ??
      process.env.PUBLIC_RUNTIME_URL ??
      "http://localhost:8080",
  ).origin;
export async function publicOrigin(): Promise<string> {
  const installation = await prisma.installation.findUnique({
    where: { id: "installation" },
    select: { publicUrl: true },
  });
  return configuredPublicOrigin(installation?.publicUrl);
}
export const platformResource = (origin: string) => `${origin}/platform/mcp`;

export function allowedScopesForRole(role: string): PlatformScope[] {
  if (["owner", "admin", "developer"].includes(role)) return [...platformScopes];
  if (role === "operator") return ["mcpops:read", "mcpops:deploy"];
  return ["mcpops:read"];
}

export function parseScopes(value: string | undefined): PlatformScope[] {
  const requested = (value ?? "mcpops:read")
    .split(/\s+/)
    .filter((item): item is PlatformScope =>
      platformScopes.includes(item as PlatformScope),
    );
  return [
    ...new Set(requested.length ? requested : ["mcpops:read"]),
  ] as PlatformScope[];
}

export function validRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function validPublicOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

const clientMetadataSchema = z
  .object({
    client_id: z.string().url(),
    client_name: z.string().min(1).max(200),
    redirect_uris: z.array(z.string()).min(1).max(20),
  })
  .passthrough();

function privateAddress(address: string): boolean {
  if (!isIP(address)) return true;
  if (
    address === "::1" ||
    address.startsWith("fe80:") ||
    address.startsWith("fc") ||
    address.startsWith("fd")
  )
    return true;
  if (
    address.startsWith("127.") ||
    address.startsWith("169.254.") ||
    address.startsWith("10.") ||
    address.startsWith("192.168.")
  )
    return true;
  const match = /^172\.(\d+)\./.exec(address);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

export async function resolveOAuthClient(clientId: string) {
  const stored = await prisma.oAuthClient.findUnique({ where: { id: clientId } });
  if (stored) return stored;
  const metadataUrl = new URL(clientId);
  if (
    metadataUrl.protocol !== "https:" ||
    !metadataUrl.pathname ||
    metadataUrl.pathname === "/"
  )
    throw oauthError("invalid_client", "Unknown OAuth client");
  const addresses = await lookup(metadataUrl.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address)))
    throw oauthError("invalid_client", "Client metadata address is not allowed");
  const response = await fetch(metadataUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok)
    throw oauthError("invalid_client", "Client metadata could not be loaded");
  const metadata = clientMetadataSchema.parse(await response.json());
  if (
    metadata.client_id !== clientId ||
    !metadata.redirect_uris.every(validRedirectUri)
  )
    throw oauthError("invalid_client", "Client metadata is invalid");
  return prisma.oAuthClient.create({
    data: {
      id: clientId,
      name: metadata.client_name,
      redirectUris: metadata.redirect_uris,
      metadataUri: clientId,
      registration: "metadata",
    },
  });
}

export function clientRedirects(client: { redirectUris: unknown }): string[] {
  return Array.isArray(client.redirectUris)
    ? client.redirectUris.filter((item): item is string => typeof item === "string")
    : [];
}

export function oauthError(code: string, message: string, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
