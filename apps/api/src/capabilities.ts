export type PlatformCapabilities = ReturnType<typeof platformCapabilities>;

export function platformCapabilities(environment: NodeJS.ProcessEnv = process.env) {
  const executorProvider =
    environment.EXECUTOR_PROVIDER === "container" ? "container" : "local";
  return {
    environment: environment.NODE_ENV ?? "development",
    executor: {
      provider: executorProvider,
      hostileCodeIsolation: executorProvider === "container",
    },
    authProviders: {
      localPassword: "enabled" as const,
      jwt:
        environment.ENABLE_JWT_AUTH === "true"
          ? ("enabled" as const)
          : ("disabled" as const),
      entraRuntime:
        environment.ENABLE_ENTRA_AUTH === "true"
          ? ("enabled" as const)
          : ("disabled" as const),
      webhookSignature: "enabled" as const,
      oidcControlPlane: "unavailable" as const,
      entraControlPlane: "unavailable" as const,
    },
    runtimeCapabilities: {
      arbitraryPackageInstallation: false,
      reviewedDatabaseQueries: environment.ENABLE_REVIEWED_DB_QUERIES === "true",
      demoMode: environment.MCP_OPS_DEMO_MODE === "true",
    },
  };
}
