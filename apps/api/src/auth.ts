import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

// projectId is the currently selected project, not a membership or authorization
// boundary. Installation-wide users can switch it through the project selector.
export type PlatformSession = { userId: string; projectId: string; role: string; email: string; sessionVersion: number; expiresAt: number };
const secret = () => process.env.SESSION_SECRET ?? (process.env.NODE_ENV === "production" ? (() => { throw new Error("SESSION_SECRET is required"); })() : "development-session-secret-change-me");
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function encodeSession(session: PlatformSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
export function decodeSession(value: string | undefined): PlatformSession | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const result = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PlatformSession;
    return result.expiresAt > Date.now() ? result : null;
  } catch { return null; }
}
export function issueSession(reply: FastifyReply, session: Omit<PlatformSession, "expiresAt">): string {
  const csrf = randomBytes(24).toString("base64url");
  const secure = process.env.COOKIE_SECURE === "true";
  reply.setCookie("mcpops_session", encodeSession({ ...session, expiresAt: Date.now() + 8 * 60 * 60 * 1000 }), { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: 28_800 });
  reply.setCookie("mcpops_csrf", csrf, { httpOnly: false, secure, sameSite: "strict", path: "/", maxAge: 28_800 });
  return csrf;
}
export function clearSession(reply: FastifyReply): void { reply.clearCookie("mcpops_session", { path: "/" }); reply.clearCookie("mcpops_csrf", { path: "/" }); }
export function requireSession(request: FastifyRequest): PlatformSession {
  const session = decodeSession(request.cookies.mcpops_session);
  if (!session) throw Object.assign(new Error("Authentication required"), { statusCode: 401, code: "UNAUTHENTICATED" });
  return session;
}
export function enforceCsrf(request: FastifyRequest): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const cookie = request.cookies.mcpops_csrf;
  const header = request.headers["x-csrf-token"];
  if (!cookie || typeof header !== "string" || header.length !== cookie.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) {
    throw Object.assign(new Error("Invalid CSRF token"), { statusCode: 403, code: "CSRF_INVALID" });
  }
}
export function requireRole(session: PlatformSession, allowed: string[]): void {
  if (!allowed.includes(session.role)) throw Object.assign(new Error("Insufficient platform role"), { statusCode: 403, code: "FORBIDDEN" });
}
