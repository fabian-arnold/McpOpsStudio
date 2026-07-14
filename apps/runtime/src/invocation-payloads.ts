import { redactSensitive } from "@mcpops/runtime-sdk";

export const payloadCaptureDisabled = {
  captured: false,
  reason: "Development payload capture is disabled",
};

const maxCapturedPayloadBytes = 64 * 1024;

export function shouldCapturePayloads(environment: {
  slug: string;
  capturePayloads?: boolean;
}): boolean {
  return environment.slug === "development" && environment.capturePayloads === true;
}

export function capturedPayload(
  value: unknown,
  secrets: readonly string[] = [],
): unknown {
  const redacted = redactSensitive(value, secrets);
  const serialized = JSON.stringify(redacted);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= maxCapturedPayloadBytes) return redacted;
  return {
    captured: true,
    truncated: true,
    originalBytes: bytes,
    preview: serialized.slice(0, 16_000),
  };
}
