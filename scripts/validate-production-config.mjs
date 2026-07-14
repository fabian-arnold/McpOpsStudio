const developmentValues = new Map([
  ["DATABASE_URL", ["mcpops_dev_password"]],
  ["MCP_OPS_MASTER_KEY", ["0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"]],
  ["SESSION_SECRET", ["replace-with-at-least-32-random-characters"]],
  ["CSRF_SECRET", ["replace-with-at-least-32-random-characters"]],
  ["INTERNAL_API_TOKEN", ["dev-internal-token-change-me"]],
  ["SEED_ADMIN_EMAIL", ["admin@acme.test"]],
  ["SEED_ADMIN_PASSWORD", ["ChangeMe123!"]],
  ["SEED_MCP_API_KEY", ["dev-acme-mcp-key"]],
]);

const requiredProductionUrls = ["PUBLIC_CONTROL_PLANE_URL", "PUBLIC_RUNTIME_URL"];
const generatedInstallRequired = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "CSRF_SECRET",
  "INTERNAL_API_TOKEN",
  "MCP_OPS_SETUP_CODE",
];

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())
    );
  } catch {
    return true;
  }
}

export function productionConfigurationErrors(environment = process.env) {
  const errors = [];
  const encodedMasterKey = environment.MCP_OPS_MASTER_KEY;
  if (!encodedMasterKey || !validMasterKey(encodedMasterKey)) {
    errors.push("MCP_OPS_MASTER_KEY must explicitly encode exactly 32 bytes as 64 hexadecimal characters or base64");
  }
  if (environment.NODE_ENV !== "production") return errors;

  if (environment.MCP_OPS_INSTALL_MODE === "browser") {
    for (const name of generatedInstallRequired) {
      const value = environment[name];
      if (!value || value.length < 16)
        errors.push(`${name} must be supplied by the generated installation configuration`);
    }
    if (environment.MCP_OPS_DEMO_MODE === "true")
      errors.push("MCP_OPS_DEMO_MODE must be disabled in production");
    if (environment.MOCK_CRM_URL)
      errors.push("MOCK_CRM_URL is development-only and must not be configured in production");
    return errors;
  }

  for (const [name, forbiddenFragments] of developmentValues) {
    const value = environment[name];
    if (!value) {
      errors.push(`${name} must be explicitly configured in production`);
      continue;
    }
    if (forbiddenFragments.some((fragment) => value.includes(fragment))) {
      errors.push(`${name} contains a known development value`);
    }
  }

  for (const name of requiredProductionUrls) {
    const value = environment[name];
    if (!value || isLocalUrl(value)) {
      errors.push(`${name} must be an explicit non-local HTTPS URL in production`);
    }
  }

  if (environment.MCP_OPS_DEMO_MODE === "true") {
    errors.push("MCP_OPS_DEMO_MODE must be disabled in production");
  }
  if (environment.MOCK_CRM_URL) {
    errors.push("MOCK_CRM_URL is development-only and must not be configured in production");
  }

  return errors;
}

function validMasterKey(value) {
  if (/^[0-9a-f]{64}$/i.test(value)) return true;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return false;
  return Buffer.from(value, "base64").length === 32;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = productionConfigurationErrors();
  if (errors.length > 0) {
    console.error(JSON.stringify({
      level: "fatal",
      message: "refusing to start with unsafe production configuration",
      errors,
    }));
    process.exitCode = 1;
  }
}
import { pathToFileURL } from "node:url";
