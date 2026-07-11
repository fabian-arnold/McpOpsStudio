import { describe, expect, it } from "vitest";
import { functionTemplates } from "@mcpops/shared";
import { previewTemplateInstallation } from "./template-install.js";

const context = { allowedHosts: [] as string[], secrets: [] as Array<{ id: string; name: string }>, authPolicies: [] as Array<{ id: string; type: string }>, capabilities: ["network_policy"] };

describe("template installation preview", () => {
  it("blocks reviewed-query templates while their provider capability is disabled", () => {
    const template = functionTemplates.find((candidate) => candidate.id === "postgres-read-query")!;
    expect(previewTemplateInstallation(template, {}, context)).toMatchObject({ installable: false, enabledAfterInstall: false, missingCapabilities: ["reviewed_database_queries"] });
    expect(previewTemplateInstallation(template, {}, { ...context, capabilities: ["network_policy", "reviewed_database_queries"] })).toMatchObject({ installable: true, enabledAfterInstall: false });
  });

  it("requires an existing exact secret grant and webhook policy", () => {
    const template = functionTemplates.find((candidate) => candidate.id === "webhook")!;
    const configured = { ...context, capabilities: ["webhook_signature_auth"], secrets: [{ id: "secret-1", name: "WEBHOOK_SIGNING_SECRET" }], authPolicies: [{ id: "policy-1", type: "webhook_signature" }] };
    expect(previewTemplateInstallation(template, { secretGrants: { WEBHOOK_SIGNING_SECRET: "secret-1" }, authPolicyId: "policy-1" }, configured)).toMatchObject({ installable: true, enabledAfterInstall: false, missingSecrets: [] });
  });

  it("requires network policy review instead of mutating allowlists", () => {
    const template = functionTemplates.find((candidate) => candidate.id === "http-api-proxy")!;
    expect(previewTemplateInstallation(template, {}, context)).toMatchObject({ installable: false, missingHosts: ["api.example.com"] });
    expect(previewTemplateInstallation(template, {}, { ...context, allowedHosts: ["api.example.com"] })).toMatchObject({ installable: true, enabledAfterInstall: false });
  });
});
