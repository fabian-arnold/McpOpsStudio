import { SafeRuntimeError } from "@mcpops/runtime-sdk";

type AuthFeature = "ENABLE_JWT_AUTH" | "ENABLE_ENTRA_AUTH";

export function runtimeAuthFeatureEnabled(
  environment: NodeJS.ProcessEnv,
  name: AuthFeature,
): boolean {
  return environment[name] === "true";
}

export function assertAuthFeatureEnabled(
  name: AuthFeature,
  label: string,
  requestId: string,
): void {
  if (!runtimeAuthFeatureEnabled(process.env, name))
    throw new SafeRuntimeError({
      code: "CONFIGURATION_ERROR",
      message: `${label} runtime authentication is disabled by configuration.`,
      requestId,
    });
}
