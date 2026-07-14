import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { type webhookSignaturePolicyConfigSchema } from "@mcpops/shared";
import { SafeRuntimeError, type CallerIdentity } from "@mcpops/runtime-sdk";

type WebhookConfig = ReturnType<typeof webhookSignaturePolicyConfigSchema.parse>;
export interface ReplayStore {
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}

export async function verifyWebhookRequest(input: {
  headers: Record<string, unknown>;
  rawBody: Buffer;
  config: WebhookConfig;
  secret: string;
  policyId: string;
  replayStore: ReplayStore;
  requestId: string;
  now: Date;
}): Promise<CallerIdentity> {
  const timestampValue = singleHeader(input.headers, input.config.timestampHeader);
  const signatureValue = singleHeader(input.headers, input.config.header);
  if (!timestampValue || !signatureValue || !/^\d{10}$/.test(timestampValue))
    unauthenticated(input.requestId);
  const timestamp = Number(timestampValue);
  if (
    Math.abs(Math.floor(input.now.getTime() / 1000) - timestamp) >
    input.config.toleranceSeconds
  )
    unauthenticated(input.requestId);
  if (!signatureValue.startsWith(input.config.signaturePrefix))
    unauthenticated(input.requestId);
  const providedHex = signatureValue.slice(input.config.signaturePrefix.length);
  if (!/^[a-f0-9]{64}$/i.test(providedHex)) unauthenticated(input.requestId);
  const canonical = Buffer.concat([
    Buffer.from(timestampValue + ".", "utf8"),
    input.rawBody,
  ]);
  const expected = createHmac("sha256", input.secret).update(canonical).digest();
  const provided = Buffer.from(providedHex, "hex");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
    unauthenticated(input.requestId);
  const replayKey = `mcpops:webhook-replay:${createHash("sha256").update(`${input.policyId}:${timestampValue}:${providedHex.toLowerCase()}`).digest("hex")}`;
  // Two tolerance windows cover tokens timestamped at the maximum accepted future skew.
  let claimed: boolean;
  try {
    claimed = await input.replayStore.claim(
      replayKey,
      input.config.toleranceSeconds * 2,
    );
  } catch {
    throw new SafeRuntimeError({
      code: "CONFIGURATION_ERROR",
      message: "Webhook replay protection is temporarily unavailable.",
      requestId: input.requestId,
      retryable: true,
    });
  }
  if (!claimed) unauthenticated(input.requestId);
  return {
    subject: `webhook:${input.policyId}`,
    permissions: input.config.permissions,
    claims: { authenticationPolicyId: input.policyId, signedAt: timestamp },
  };
}
export function assertWebhookEndpoint(
  endpoint: "mcp" | "http",
  requestId: string,
): void {
  if (endpoint !== "http")
    configuration(
      "Webhook signature policies can only authenticate HTTP route bindings.",
      requestId,
    );
}

function singleHeader(
  headers: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}
function unauthenticated(requestId: string): never {
  throw new SafeRuntimeError({
    code: "UNAUTHENTICATED",
    message: "Authentication failed.",
    requestId,
  });
}
function configuration(message: string, requestId: string): never {
  throw new SafeRuntimeError({ code: "CONFIGURATION_ERROR", message, requestId });
}
