import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import { decodeSession } from "./auth.js";
import { parse, requestId, sessionContext } from "./helpers.js";
import {
  allowedScopesForRole,
  clientRedirects,
  hashToken,
  oauthError,
  opaqueToken,
  parseScopes,
  platformResource,
  platformScopes,
  publicOrigin,
  resolveOAuthClient,
  validPublicOrigin,
  validRedirectUri,
  type OAuthRequestState,
} from "./oauth.js";
import { controlPlaneState } from "./resources.js";

const authorizeSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  scope: z.string().optional(),
  state: z.string().max(2048).optional(),
  resource: z.string().url(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
});
const registrationSchema = z.object({
  client_name: z.string().min(1).max(200),
  redirect_uris: z.array(z.string()).min(1).max(20),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.literal("none").optional(),
});

export async function registerOAuthRoutes(app: FastifyInstance): Promise<void> {
  if (process.env.NODE_ENV === "production" && !validPublicOrigin(await publicOrigin()))
    throw new Error("PUBLIC_CONTROL_PLANE_URL must use HTTPS for platform MCP OAuth");
  app.get("/.well-known/oauth-protected-resource/platform/mcp", async () => {
    const origin = await publicOrigin();
    return {
      resource: platformResource(origin),
      authorization_servers: [origin],
      scopes_supported: platformScopes,
      resource_name: "MCP Ops Studio Platform",
    };
  });
  app.get("/.well-known/oauth-protected-resource", async () => {
    const origin = await publicOrigin();
    return {
      resource: platformResource(origin),
      authorization_servers: [origin],
      scopes_supported: platformScopes,
    };
  });
  app.get("/.well-known/oauth-authorization-server", async () => {
    const origin = await publicOrigin();
    return {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: platformScopes,
      client_id_metadata_document_supported: true,
    };
  });

  app.post("/oauth/register", async (request, reply) => {
    const body = parse(registrationSchema, request.body);
    if (!body.redirect_uris.every(validRedirectUri))
      throw oauthError(
        "invalid_redirect_uri",
        "Redirect URIs must use HTTPS or a loopback HTTP address",
      );
    const id = `mcp_${opaqueToken()}`;
    await prisma.oAuthClient.create({
      data: {
        id,
        name: body.client_name,
        redirectUris: body.redirect_uris,
        registration: "dynamic",
      },
    });
    return reply.status(201).send({
      client_id: id,
      client_name: body.client_name,
      redirect_uris: body.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  app.get("/oauth/authorize", async (request, reply) => {
    const query = parse(authorizeSchema, request.query);
    const origin = await publicOrigin();
    if (query.resource !== platformResource(origin))
      throw oauthError(
        "invalid_target",
        "The resource must be the platform MCP endpoint",
      );
    const client = await resolveOAuthClient(query.client_id);
    if (!clientRedirects(client).includes(query.redirect_uri))
      throw oauthError(
        "invalid_request",
        "The redirect URI is not registered for this client",
      );
    const session = decodeSession(request.cookies.mcpops_session);
    if (!session) {
      const returnTo = `${request.url}`;
      return reply.redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    }
    const allowed = new Set(allowedScopesForRole(session.role));
    const scopes = parseScopes(query.scope).filter((scope) => allowed.has(scope));
    if (!scopes.includes("mcpops:read")) scopes.unshift("mcpops:read");
    const approvalId = opaqueToken();
    const approval: OAuthRequestState = {
      clientId: client.id,
      clientName: client.name,
      redirectUri: query.redirect_uri,
      scopes,
      ...(query.state ? { state: query.state } : {}),
      resource: query.resource,
      codeChallenge: query.code_challenge,
    };
    await controlPlaneState.set(
      `oauth:request:${approvalId}`,
      JSON.stringify(approval),
      "EX",
      600,
    );
    return reply.redirect(`/oauth/consent?request=${encodeURIComponent(approvalId)}`);
  });

  app.get("/api/oauth/requests/:approvalId", async (request) => {
    const session = sessionContext(request);
    const { approvalId } = request.params as { approvalId: string };
    const raw = await controlPlaneState.get(`oauth:request:${approvalId}`);
    if (!raw) throw oauthError("NOT_FOUND", "Authorization request expired", 404);
    const approval = JSON.parse(raw) as OAuthRequestState;
    return {
      clientName: approval.clientName,
      redirectUri: approval.redirectUri,
      scopes: approval.scopes,
      user: { email: session.email, role: session.role },
    };
  });

  app.post("/api/oauth/requests/:approvalId/decision", async (request) => {
    const session = sessionContext(request);
    const { approvalId } = request.params as { approvalId: string };
    const { approve } = parse(z.object({ approve: z.boolean() }), request.body);
    const key = `oauth:request:${approvalId}`;
    const raw = await controlPlaneState.get(key);
    if (!raw) throw oauthError("NOT_FOUND", "Authorization request expired", 404);
    await controlPlaneState.del(key);
    const approval = JSON.parse(raw) as OAuthRequestState;
    const destination = new URL(approval.redirectUri);
    if (!approve) destination.searchParams.set("error", "access_denied");
    else {
      const code = opaqueToken();
      await prisma.oAuthAuthorizationCode.create({
        data: {
          codeHash: hashToken(code),
          clientId: approval.clientId,
          userId: session.userId,
          redirectUri: approval.redirectUri,
          scopes: approval.scopes,
          resource: approval.resource,
          codeChallenge: approval.codeChallenge,
          expiresAt: new Date(Date.now() + 5 * 60_000),
        },
      });
      destination.searchParams.set("code", code);
    }
    if (approval.state) destination.searchParams.set("state", approval.state);
    return { redirectTo: destination.toString() };
  });

  app.post("/oauth/token", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const body = request.body as Record<string, string | undefined>;
    if (body.grant_type === "authorization_code") {
      const codeHash = hashToken(String(body.code ?? ""));
      const record = await prisma.oAuthAuthorizationCode.findUnique({
        where: { codeHash },
        include: { user: true },
      });
      if (!record || record.consumedAt || record.expiresAt <= new Date())
        throw oauthError("invalid_grant", "Authorization code is invalid or expired");
      if (
        record.clientId !== body.client_id ||
        record.redirectUri !== body.redirect_uri ||
        record.resource !== body.resource
      )
        throw oauthError("invalid_grant", "Authorization code context does not match");
      const challenge = createHash("sha256")
        .update(String(body.code_verifier ?? ""))
        .digest("base64url");
      if (
        challenge.length !== record.codeChallenge.length ||
        !timingSafeEqual(Buffer.from(challenge), Buffer.from(record.codeChallenge))
      )
        throw oauthError("invalid_grant", "PKCE verification failed");
      const access = opaqueToken();
      const refresh = opaqueToken();
      await prisma.$transaction(async (tx) => {
        const consumed = await tx.oAuthAuthorizationCode.updateMany({
          where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } },
          data: { consumedAt: new Date() },
        });
        if (!consumed.count)
          throw oauthError("invalid_grant", "Authorization code was already used");
        await tx.oAuthGrant.create({
          data: {
            clientId: record.clientId,
            userId: record.userId,
            scopes: record.scopes,
            resource: record.resource,
            accessTokenHash: hashToken(access),
            refreshTokenHash: hashToken(refresh),
            accessExpiresAt: new Date(Date.now() + 15 * 60_000),
            refreshExpiresAt: new Date(Date.now() + 8 * 60 * 60_000),
          },
        });
      });
      return {
        access_token: access,
        refresh_token: refresh,
        token_type: "Bearer",
        expires_in: 900,
        scope: record.scopes.join(" "),
      };
    }
    if (body.grant_type === "refresh_token") {
      const refreshHash = hashToken(String(body.refresh_token ?? ""));
      const grant = await prisma.oAuthGrant.findUnique({
        where: { refreshTokenHash: refreshHash },
      });
      if (
        !grant ||
        grant.revokedAt ||
        !grant.refreshExpiresAt ||
        grant.refreshExpiresAt <= new Date() ||
        grant.clientId !== body.client_id
      )
        throw oauthError("invalid_grant", "Refresh token is invalid or expired");
      const access = opaqueToken();
      const refresh = opaqueToken();
      const rotated = await prisma.oAuthGrant.updateMany({
        where: { id: grant.id, refreshTokenHash: refreshHash, revokedAt: null },
        data: {
          accessTokenHash: hashToken(access),
          refreshTokenHash: hashToken(refresh),
          accessExpiresAt: new Date(Date.now() + 15 * 60_000),
        },
      });
      if (!rotated.count)
        throw oauthError("invalid_grant", "Refresh token was already used");
      return {
        access_token: access,
        refresh_token: refresh,
        token_type: "Bearer",
        expires_in: 900,
        scope: grant.scopes.join(" "),
      };
    }
    throw oauthError("unsupported_grant_type", "Unsupported OAuth grant type");
  });

  app.get("/api/oauth/grants", async (request) => {
    const session = sessionContext(request);
    const grants = await prisma.oAuthGrant.findMany({
      where: {
        userId: session.userId,
        revokedAt: null,
        refreshExpiresAt: { gt: new Date() },
      },
      include: { client: true },
      orderBy: { updatedAt: "desc" },
    });
    return grants.map((grant) => ({
      id: grant.id,
      clientName: grant.client.name,
      scopes: grant.scopes,
      createdAt: grant.createdAt,
      expiresAt: grant.refreshExpiresAt,
    }));
  });
  app.delete("/api/oauth/grants/:grantId", async (request, reply) => {
    const session = sessionContext(request);
    const { grantId } = request.params as { grantId: string };
    const updated = await prisma.oAuthGrant.updateMany({
      where: { id: grantId, userId: session.userId },
      data: { revokedAt: new Date(), refreshTokenHash: null },
    });
    if (!updated.count)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "OAuth grant not found",
          requestId: requestId(request),
        },
      });
    return reply.status(204).send();
  });
}
