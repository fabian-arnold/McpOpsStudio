import type { FunctionTemplate } from "@mcpops/shared";
import { z } from "zod";

export const templateInstallSelectionSchema = z.object({
  secretGrants: z.record(z.string(), z.string().uuid()).default({}),
  authPolicyId: z.string().uuid().optional(),
}).strict();

export type TemplateInstallSelection = {
  secretGrants?: Record<string, string>;
  authPolicyId?: string;
};

export type TemplateInstallContext = {
  allowedHosts: string[];
  secrets: Array<{ id: string; name: string }>;
  authPolicies: Array<{ id: string; type: string }>;
  capabilities: string[];
};

export type TemplateInstallPreview = {
  templateId: string;
  installable: boolean;
  enabledAfterInstall: boolean;
  missingSecrets: string[];
  missingHosts: string[];
  missingCapabilities: string[];
  policyError?: string;
  policyBlockers: string[];
  warnings: string[];
  draft: { enabled: boolean; riskLevel: FunctionTemplate["riskLevel"] };
  exactChanges: {
    function: { slug: string; enabled: boolean; riskLevel: FunctionTemplate["riskLevel"]; permissions: string[] };
    secretGrantIds: string[];
    bindings: FunctionTemplate["bindings"];
    networkPolicyMutation: false;
  };
  documentation: FunctionTemplate["documentation"];
  fixtures: FunctionTemplate["fixtures"];
};

export function previewTemplateInstallation(
  template: FunctionTemplate,
  selection: TemplateInstallSelection,
  context: TemplateInstallContext,
): TemplateInstallPreview {
  const secretsById = new Map(context.secrets.map((secret) => [secret.id, secret]));
  const grants = selection.secretGrants ?? {};
  const missingSecrets = template.secrets.filter((name) => {
    const selected = secretsById.get(grants[name] ?? "");
    return !selected || selected.name !== name;
  });
  const missingHosts = template.allowedHosts.filter((host) => !context.allowedHosts.includes(host));
  const availableCapabilities = new Set(context.capabilities);
  const missingCapabilities = template.availability.requiredCapabilities.filter((capability) => !availableCapabilities.has(capability));
  if (template.availability.status === "provider_unavailable") missingCapabilities.push(...template.availability.requiredCapabilities.filter((capability) => !missingCapabilities.includes(capability)));

  let policyError: string | undefined;
  if (template.id === "webhook") {
    const policy = context.authPolicies.find((candidate) => candidate.id === selection.authPolicyId);
    if (!policy || policy.type !== "webhook_signature") policyError = "Select a webhook-signature authentication policy.";
  }

  const installable = missingSecrets.length === 0 && missingHosts.length === 0 && missingCapabilities.length === 0 && !policyError;
  const enabledAfterInstall = installable && template.availability.enabledByDefault;
  return {
    templateId: template.id,
    installable,
    enabledAfterInstall,
    missingSecrets,
    missingHosts,
    missingCapabilities: [...new Set(missingCapabilities)],
    ...(policyError ? { policyError } : {}),
    policyBlockers: policyError ? [policyError] : [],
    warnings: enabledAfterInstall ? [] : ["The function and its bindings will remain disabled until explicitly enabled after review."],
    draft: { enabled: enabledAfterInstall, riskLevel: template.riskLevel },
    exactChanges: {
      function: { slug: template.id, enabled: enabledAfterInstall, riskLevel: template.riskLevel, permissions: template.permissions },
      secretGrantIds: template.secrets.map((name) => grants[name]).filter((id): id is string => typeof id === "string"),
      bindings: template.bindings,
      networkPolicyMutation: false,
    },
    documentation: template.documentation,
    fixtures: template.fixtures,
  };
}
