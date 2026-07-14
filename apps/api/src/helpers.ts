import { createHash, randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { type z, ZodError } from "zod";
import { requireSession, type PlatformSession } from "./auth.js";

export const checksum = (input: string) =>
  createHash("sha256").update(input).digest("hex");
export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  return schema.parse(value) as z.output<S>;
}
export function sessionContext(request: FastifyRequest): PlatformSession {
  return requireSession(request);
}
export function requestId(request: FastifyRequest): string {
  return String(request.id || request.headers["x-request-id"] || randomUUID());
}
export function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  error: unknown,
): void {
  const value = error as { statusCode?: number; code?: string; message?: string };
  const zod = error instanceof ZodError;
  const conflict = value.code === "P2002";
  const statusCode = zod ? 400 : conflict ? 409 : (value.statusCode ?? 500);
  reply.status(statusCode).send({
    error: {
      code: zod
        ? "VALIDATION_ERROR"
        : conflict
          ? "CONFLICT"
          : (value.code ?? "INTERNAL_ERROR"),
      message:
        statusCode >= 500
          ? "An internal error occurred"
          : conflict
            ? "A record with these unique fields already exists"
            : (value.message ?? "Request failed"),
      requestId: requestId(request),
      ...(zod ? { details: error.flatten() } : {}),
    },
  });
}
