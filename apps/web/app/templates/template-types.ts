import {
  Database,
  Globe2,
  Search,
  ShieldCheck,
  Webhook,
  Wrench,
  Zap,
} from "lucide-react";

export type Template = {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  secrets: string[];
  allowedHosts: string[];
  bindings: { mcp?: string; http?: { method: string; path: string } };
  fixtures: {
    version: number;
    items: {
      id: string;
      name: string;
      source: "mcp" | "http";
      input: unknown;
    }[];
  };
  availability: {
    status: "ready" | "requires_configuration" | "provider_unavailable";
    enabledByDefault: boolean;
    message: string;
    requiredCapabilities: string[];
  };
  documentation: {
    purpose: string;
    setup: string[];
    requirements: {
      secrets: string[];
      permissions: string[];
      networkHosts: string[];
      capabilities: string[];
    };
    exampleCalls: { source: string; input: unknown }[];
    expectedOutput: unknown;
    limitations: string[];
  };
  localExample?: boolean;
};
export type RuntimeEndpoint = {
  id: string;
  name: string;
  environment?: { name?: string };
};
export type SafeSecret = {
  id: string;
  name: string;
  environmentId: string;
  grantCount?: number;
};
export type Policy = {
  id: string;
  name: string;
  type: string;
  providerStatus?: string;
};
export type Preview = {
  installable: boolean;
  blockers?: string[] | Record<string, unknown>;
  missingSecrets?: string[];
  missingHosts?: string[];
  missingCapabilities?: string[];
  policyBlockers?: string[];
  warnings?: string[];
  draft?: { enabled?: boolean; riskLevel?: string };
  exactChanges?: unknown;
};

export const icons = {
  "http-api-proxy": Globe2,
  "postgres-read-query": Database,
  webhook: Webhook,
  "tenant-authorized": ShieldCheck,
  "read-search": Search,
  "confirmed-write": Wrench,
  "cache-lookup": Zap,
} as const;
