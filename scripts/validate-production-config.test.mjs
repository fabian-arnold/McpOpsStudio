import assert from "node:assert/strict";
import test from "node:test";
import { productionConfigurationErrors } from "./validate-production-config.mjs";

test("development configuration is allowed", () => {
  assert.deepEqual(productionConfigurationErrors({ NODE_ENV: "development", MCP_OPS_MASTER_KEY: "a".repeat(64) }), []);
});

test("invalid encryption keys are refused in every environment", () => {
  assert.match(productionConfigurationErrors({ NODE_ENV: "development", MCP_OPS_MASTER_KEY: "too-short" })[0], /exactly 32 bytes/);
});

test("known development values are refused in production", () => {
  const errors = productionConfigurationErrors({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://mcpops:mcpops_dev_password@postgres/db",
    MCP_OPS_MASTER_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    SESSION_SECRET: "replace-with-at-least-32-random-characters",
    CSRF_SECRET: "replace-with-at-least-32-random-characters",
    INTERNAL_API_TOKEN: "dev-internal-token-change-me",
    SEED_ADMIN_EMAIL: "admin@acme.test",
    SEED_ADMIN_PASSWORD: "ChangeMe123!",
    SEED_MCP_API_KEY: "dev-acme-mcp-key",
    PUBLIC_CONTROL_PLANE_URL: "http://localhost:3000",
    PUBLIC_RUNTIME_URL: "http://localhost:8080",
    MCP_OPS_DEMO_MODE: "true",
    MOCK_CRM_URL: "http://mock-crm:8090",
  });

  assert.ok(errors.length >= 10);
  assert.ok(errors.some((error) => error.includes("MCP_OPS_DEMO_MODE")));
  assert.ok(errors.some((error) => error.includes("PUBLIC_RUNTIME_URL")));
});

test("explicit secure production configuration is allowed", () => {
  assert.deepEqual(productionConfigurationErrors({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app:a-unique-password@db.example.com/mcpops",
    MCP_OPS_MASTER_KEY: "a".repeat(64),
    SESSION_SECRET: "a-distinct-session-secret-with-more-than-32-characters",
    CSRF_SECRET: "a-distinct-csrf-secret-with-more-than-32-characters",
    INTERNAL_API_TOKEN: "a-distinct-internal-api-token",
    SEED_ADMIN_EMAIL: "owner@example.com",
    SEED_ADMIN_PASSWORD: "a-distinct-bootstrap-password",
    SEED_MCP_API_KEY: "a-distinct-runtime-key",
    PUBLIC_CONTROL_PLANE_URL: "https://studio.example.com",
    PUBLIC_RUNTIME_URL: "https://runtime.example.com",
    MCP_OPS_DEMO_MODE: "false",
  }), []);
});
