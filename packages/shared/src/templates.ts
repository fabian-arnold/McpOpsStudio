export type TemplateDocumentation = {
  purpose: string;
  setup: string[];
  requirements: {
    secrets: string[];
    permissions: string[];
    networkHosts: string[];
    capabilities: string[];
  };
  exampleCalls: Array<{ source: "mcp" | "http" | "test"; input: unknown }>;
  expectedOutput: unknown;
  limitations: string[];
};

export type TemplateFixture = {
  id: string;
  name: string;
  source: "mcp" | "http";
  input: unknown;
  caller?: { subject?: string; permissions: string[] };
  tenantId?: string;
};

export type FunctionTemplate = {
  id: string;
  name: string;
  description: string;
  code: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  riskLevel: "read" | "write" | "destructive";
  permissions: string[];
  secrets: string[];
  allowedHosts: string[];
  bindings: { mcp?: string; http?: { method: string; path: string } };
  /** Compatibility fixture used by older clients. New clients use fixtures. */
  fixture: unknown;
  fixtures: { version: 1; items: TemplateFixture[] };
  availability: {
    status: "ready" | "requires_configuration" | "provider_unavailable";
    enabledByDefault: boolean;
    requiredCapabilities: string[];
    message: string;
  };
  documentation: TemplateDocumentation;
  localExample?: boolean;
};

const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const fixture = (
  id: string,
  input: unknown,
  source: "mcp" | "http" = "mcp",
): { fixture: unknown; fixtures: FunctionTemplate["fixtures"] } => ({
  fixture: input,
  fixtures: { version: 1, items: [{ id, name: "Happy path", source, input }] },
});

export const functionTemplates: FunctionTemplate[] = [
  {
    id: "http-api-proxy",
    name: "HTTP API proxy function",
    description:
      "Calls one reviewed upstream through the restricted HTTP capability.",
    code: `export default async function handler(ctx, input) {
  const response = await ctx.http.request({ method: "GET", url: input.url });
  return { data: response.data };
}`,
    inputSchema: object({ url: { type: "string", format: "uri" } }, ["url"]),
    outputSchema: object({ data: {} }, ["data"]),
    riskLevel: "read",
    permissions: ["proxy.read"],
    secrets: [],
    allowedHosts: ["api.example.com"],
    bindings: {
      mcp: "proxy_request",
      http: { method: "POST", path: "/v1/proxy" },
    },
    ...fixture("status", { url: "https://api.example.com/status" }),
    availability: {
      status: "requires_configuration",
      enabledByDefault: false,
      requiredCapabilities: ["network_policy"],
      message:
        "Select and review the exact upstream host before enabling this function.",
    },
    documentation: {
      purpose:
        "Expose a small read-only upstream operation through both MCP and HTTP.",
      setup: [
        "Replace api.example.com with the reviewed upstream.",
        "Review method, port, response-size and redirect policy.",
        "Enable the function and bindings after validation.",
      ],
      requirements: {
        secrets: [],
        permissions: ["proxy.read"],
        networkHosts: ["api.example.com"],
        capabilities: ["restricted_http"],
      },
      exampleCalls: [
        { source: "mcp", input: { url: "https://api.example.com/status" } },
        { source: "http", input: { url: "https://api.example.com/status" } },
      ],
      expectedOutput: { data: "Upstream JSON value" },
      limitations: [
        "GET only in the starter code.",
        "The URL host must match the immutable network policy.",
      ],
    },
  },
  {
    id: "postgres-read-query",
    name: "PostgreSQL read-query function",
    description:
      "Demonstrates the reviewed query-definition contract without exposing raw SQL.",
    code: `export default async function handler(ctx, input) {
  return ctx.db.query({ connection: "analytics", queryId: "customers_search", params: input });
}`,
    inputSchema: object({ query: { type: "string" } }, ["query"]),
    outputSchema: object({ rows: { type: "array" } }, ["rows"]),
    riskLevel: "read",
    permissions: ["analytics.read"],
    secrets: [],
    allowedHosts: [],
    bindings: { mcp: "search_analytics" },
    ...fixture("customer-search", { query: "ada" }),
    availability: {
      status: "requires_configuration",
      enabledByDefault: false,
      requiredCapabilities: ["reviewed_database_queries"],
      message:
        "Installs disabled. Select and grant an exact reviewed query version before enabling the function or binding.",
    },
    documentation: {
      purpose: "Show the future queryId-based database programming model.",
      setup: [
        "Enable the reviewed-query provider.",
        "Create or select the `analytics` connection and `customers_search` reviewed query definition.",
        "Grant this function the exact reviewed query version before enabling it.",
      ],
      requirements: {
        secrets: [],
        permissions: ["analytics.read"],
        networkHosts: [],
        capabilities: ["reviewed_database_queries"],
      },
      exampleCalls: [{ source: "mcp", input: { query: "ada" } }],
      expectedOutput: { rows: [] },
      limitations: [
        "The installed draft remains disabled until an administrator grants an exact reviewed query version.",
        "Function authors never supply SQL.",
      ],
    },
  },
  {
    id: "webhook",
    name: "Simple webhook receiver",
    description:
      "Receives a webhook only after a signature policy and secret are selected.",
    code: `export default async function handler(ctx, input) {
  await ctx.audit.write({ action: "webhook.received", targetType: "event", targetId: input.id, metadata: { type: input.type } });
  return { accepted: true };
}`,
    inputSchema: object({ id: { type: "string" }, type: { type: "string" } }, [
      "id",
      "type",
    ]),
    outputSchema: object({ accepted: { type: "boolean" } }, ["accepted"]),
    riskLevel: "write",
    permissions: ["webhooks.receive"],
    secrets: ["WEBHOOK_SIGNING_SECRET"],
    allowedHosts: [],
    bindings: { http: { method: "POST", path: "/webhooks/events" } },
    ...fixture(
      "customer-updated",
      { id: "evt_1", type: "customer.updated" },
      "http",
    ),
    availability: {
      status: "requires_configuration",
      enabledByDefault: false,
      requiredCapabilities: ["webhook_signature_auth"],
      message:
        "Create/select a signing secret and validated webhook-signature policy before enabling the route.",
    },
    documentation: {
      purpose:
        "Accept a small signed event and create an immutable domain audit record.",
      setup: [
        "Create or select a signing secret.",
        "Configure canonicalization, timestamp tolerance and replay protection.",
        "Bind the policy to the route, then enable it.",
      ],
      requirements: {
        secrets: ["WEBHOOK_SIGNING_SECRET"],
        permissions: ["webhooks.receive"],
        networkHosts: [],
        capabilities: ["webhook_signature_auth"],
      },
      exampleCalls: [
        { source: "http", input: { id: "evt_1", type: "customer.updated" } },
      ],
      expectedOutput: { accepted: true },
      limitations: [
        "Installed disabled until signature configuration is complete.",
        "No arbitrary middleware or streaming body handling.",
      ],
    },
  },
  {
    id: "tenant-authorized",
    name: "Tenant-aware authorized function",
    description:
      "Requires normalized tenant context and an explicit permission.",
    code: `import { requirePermission } from "@mcpops/shared/auth";
export default async function handler(ctx, input) {
  requirePermission(ctx, "tenant.read");
  if (!ctx.tenant?.id) throw new Error("Tenant required");
  return { tenantId: ctx.tenant.id, value: input.value };
}`,
    inputSchema: object({ value: {} }, ["value"]),
    outputSchema: object({ tenantId: { type: "string" }, value: {} }, [
      "tenantId",
      "value",
    ]),
    riskLevel: "read",
    permissions: ["tenant.read"],
    secrets: [],
    allowedHosts: [],
    bindings: {
      mcp: "tenant_lookup",
      http: { method: "POST", path: "/v1/tenant/lookup" },
    },
    fixture: { value: "demo" },
    fixtures: {
      version: 1,
      items: [
        {
          id: "tenant",
          name: "Tenant-scoped read",
          source: "mcp",
          input: { value: "demo" },
          tenantId: "tenant-acme",
          caller: { subject: "fixture-user", permissions: ["tenant.read"] },
        },
      ],
    },
    availability: {
      status: "ready",
      enabledByDefault: true,
      requiredCapabilities: [],
      message:
        "Ready to install; review the tenant claim mapping for your auth provider.",
    },
    documentation: {
      purpose:
        "Demonstrate tenant context and permission checks on the shared runtime contract.",
      setup: [
        "Map a trusted tenant claim in the endpoint auth policy.",
        "Grant tenant.read to the caller.",
      ],
      requirements: {
        secrets: [],
        permissions: ["tenant.read"],
        networkHosts: [],
        capabilities: [],
      },
      exampleCalls: [{ source: "mcp", input: { value: "demo" } }],
      expectedOutput: { tenantId: "tenant-acme", value: "demo" },
      limitations: ["The template does not define tenant membership storage."],
    },
  },
  {
    id: "read-search",
    name: "Local read-only search example",
    description:
      "A clearly labeled local example that echoes a synthetic result; replace it with a reviewed provider before production use.",
    code: `export default async function handler(ctx, input) {
  ctx.logger.info("Local search example", { query: input.query });
  return { items: [{ id: "local-example", name: input.query, source: "synthetic-local-example" }] };
}`,
    inputSchema: object(
      { query: { type: "string" }, limit: { type: "number" } },
      ["query"],
    ),
    outputSchema: object({ items: { type: "array" } }, ["items"]),
    riskLevel: "read",
    permissions: ["search.read"],
    secrets: [],
    allowedHosts: [],
    bindings: { mcp: "search", http: { method: "GET", path: "/v1/search" } },
    ...fixture("local-search", { query: "ada", limit: 10 }),
    availability: {
      status: "ready",
      enabledByDefault: true,
      requiredCapabilities: [],
      message:
        "Ready as a local learning example; it does not query real data.",
    },
    localExample: true,
    documentation: {
      purpose:
        "Teach schemas, logging and dual MCP/HTTP bindings without an external dependency.",
      setup: [
        "Use only for local learning.",
        "Replace the synthetic return value with ctx.http or another reviewed provider before real use.",
      ],
      requirements: {
        secrets: [],
        permissions: ["search.read"],
        networkHosts: [],
        capabilities: [],
      },
      exampleCalls: [
        { source: "mcp", input: { query: "ada", limit: 10 } },
        { source: "http", input: { query: "ada", limit: 10 } },
      ],
      expectedOutput: {
        items: [
          {
            id: "local-example",
            name: "ada",
            source: "synthetic-local-example",
          },
        ],
      },
      limitations: [
        "Returns synthetic data and is explicitly not an operational search provider.",
      ],
    },
  },
  {
    id: "confirmed-write",
    name: "Write action requiring confirmation",
    description:
      "Audited write-risk function with explicit confirmation metadata.",
    code: `export default async function handler(ctx, input) {
  if (!input.confirmation?.confirmed) throw new Error("Confirmation required");
  await ctx.audit.write({ action: "record.updated", targetType: "record", targetId: input.id, metadata: { reason: input.confirmation.reason } });
  return { updated: true };
}`,
    inputSchema: object(
      {
        id: { type: "string" },
        confirmation: object(
          { confirmed: { type: "boolean" }, reason: { type: "string" } },
          ["confirmed", "reason"],
        ),
      },
      ["id", "confirmation"],
    ),
    outputSchema: object({ updated: { type: "boolean" } }, ["updated"]),
    riskLevel: "write",
    permissions: ["records.write"],
    secrets: [],
    allowedHosts: [],
    bindings: {
      mcp: "update_record",
      http: { method: "POST", path: "/v1/records/:id" },
    },
    ...fixture("confirmed-write", {
      id: "1",
      confirmation: { confirmed: true, reason: "Approved" },
    }),
    availability: {
      status: "ready",
      enabledByDefault: true,
      requiredCapabilities: [],
      message:
        "Ready to install; connect a real reviewed side effect before production use.",
    },
    documentation: {
      purpose:
        "Demonstrate write risk, permission, confirmation and immutable audit metadata.",
      setup: [
        "Review the confirmation contract.",
        "Replace the demonstration-only success return with a reviewed side effect.",
      ],
      requirements: {
        secrets: [],
        permissions: ["records.write"],
        networkHosts: [],
        capabilities: [],
      },
      exampleCalls: [
        {
          source: "mcp",
          input: {
            id: "1",
            confirmation: { confirmed: true, reason: "Approved" },
          },
        },
      ],
      expectedOutput: { updated: true },
      limitations: [
        "The starter emits audit metadata but does not mutate an external record.",
      ],
    },
  },
  {
    id: "cache-lookup",
    name: "Cache-backed lookup",
    description: "Uses scoped Redis cache around a reviewed outbound lookup.",
    code: `export default async function handler(ctx, input) {
  return ctx.cache.getOrSet(
    "customer:" + input.customerId,
    () => ctx.http.request({ method: "GET", url: "https://api.example.com/customers/" + encodeURIComponent(input.customerId) }),
    { ttlSeconds: 300 }
  );
}`,
    inputSchema: object({ customerId: { type: "string" } }, ["customerId"]),
    outputSchema: object({}),
    riskLevel: "read",
    permissions: ["customers.read"],
    secrets: [],
    allowedHosts: ["api.example.com"],
    bindings: { mcp: "cached_customer" },
    ...fixture("customer", { customerId: "cus_1" }),
    availability: {
      status: "requires_configuration",
      enabledByDefault: false,
      requiredCapabilities: ["network_policy"],
      message:
        "Select and review the exact upstream host before enabling this function.",
    },
    documentation: {
      purpose:
        "Demonstrate function-scoped cache getOrSet around restricted HTTP.",
      setup: [
        "Replace api.example.com with the reviewed host.",
        "Review network policy and cache TTL.",
      ],
      requirements: {
        secrets: [],
        permissions: ["customers.read"],
        networkHosts: ["api.example.com"],
        capabilities: ["restricted_http", "scoped_cache"],
      },
      exampleCalls: [{ source: "mcp", input: { customerId: "cus_1" } }],
      expectedOutput: { status: 200, data: "Reviewed upstream response" },
      limitations: [
        "The starter host is a placeholder and the function installs disabled.",
      ],
    },
  },
];
