import assert from "node:assert/strict";

const control = process.env.E2E_CONTROL_URL ?? "http://localhost:8080/api";
const runtime = process.env.E2E_RUNTIME_URL ?? "http://localhost:8080";
const apiKey = process.env.SEED_MCP_API_KEY ?? "dev-acme-mcp-key";
const productionRuntime =
  process.env.E2E_PRODUCTION_RUNTIME_URL ?? runtime;
const productionApiKey =
  process.env.SEED_PRODUCTION_MCP_API_KEY ?? "prod-acme-mcp-key";

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok)
    throw new Error(`${response.status} ${url}: ${JSON.stringify(body)}`);
  return { response, body };
}

async function waitForDeployment(deploymentId, cookie) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const deployments = await json(`${control}/deployments`, {
      headers: { cookie },
    });
    const current = deployments.body.items.find(
      (entry) => entry.id === deploymentId,
    );
    if (current?.status === "active") return current;
    if (current?.status === "failed")
      throw new Error(`Deployment failed: ${JSON.stringify(current.logs)}`);
    if (attempt === 59)
      throw new Error("Deployment did not activate within 60 seconds");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const login = await json(`${control}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@acme.test", password: "ChangeMe123!" }),
});
assert.equal(
  login.body.user.project.slug,
  "acme",
  "seeded login returns the Acme project",
);
const cookies =
  login.response.headers.getSetCookie?.() ??
  [login.response.headers.get("set-cookie")].filter(Boolean);
const cookie = cookies.map((value) => value.split(";", 1)[0]).join("; ");
const csrf = login.body.csrfToken;
const endpoints = await json(`${control}/runtime-endpoints`, { headers: { cookie } });
const mcpEndpoint = endpoints.body.find(
  (entry) => entry.kind === "mcp" && entry.slug === "customer-operations",
);
const httpEndpoint = endpoints.body.find(
  (entry) => entry.kind === "http" && entry.slug === "customer-operations",
);
assert.ok(mcpEndpoint, "seeded Customer Operations MCP Endpoint exists");
assert.ok(httpEndpoint, "seeded Customer Operations HTTP API exists");
const availablePolicies = await json(`${control}/auth-policies`, {
  headers: { cookie },
});
const seededDefaultPolicy = availablePolicies.body[0];
assert.ok(seededDefaultPolicy, "seeded authentication policy exists");
for (const endpoint of endpoints.body.filter(
  (entry) => !entry.defaultAuthPolicyId,
))
  await json(
    `${control}/runtime-endpoints/${endpoint.id}/auth-policies/${seededDefaultPolicy.id}/default`,
    {
      method: "POST",
      headers: {
        cookie,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: "{}",
    },
  );

const currentSecrets = await json(`${control}/secrets`, { headers: { cookie } });
const environments = await json(`${control}/environments`, {
  headers: { cookie },
});
for (const environment of environments.body)
  if (
    !currentSecrets.body.some(
      (secret) =>
        secret.environmentId === environment.id &&
        secret.name === "E2E_BASIC_PASSWORD",
    )
  )
    await json(`${control}/secrets`, {
      method: "POST",
      headers: {
        cookie,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        environmentId: environment.id,
        name: "E2E_BASIC_PASSWORD",
        value: "e2e-basic-password",
      }),
    });
let basicPolicy = availablePolicies.body.find(
  (policy) => policy.name === "E2E Basic authentication",
);
if (!basicPolicy)
  basicPolicy = (
    await json(`${control}/runtime-endpoints/${httpEndpoint.id}/auth-policies`, {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
      body: JSON.stringify({
        name: "E2E Basic authentication",
        type: "basic_auth",
        config: {
          header: "authorization",
          scheme: "Basic",
          username: "e2e-client",
          secretRef: "E2E_BASIC_PASSWORD",
          permissions: ["customers.read"],
        },
      }),
    })
  ).body;
assert.equal(basicPolicy.type, "basic_auth", "endpoint authentication policies can be created");
let publicPolicy = availablePolicies.body.find(
  (policy) => policy.name === "E2E Public HTTP access",
);
if (!publicPolicy)
  publicPolicy = (
    await json(`${control}/runtime-endpoints/${httpEndpoint.id}/auth-policies`, {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
      body: JSON.stringify({
        name: "E2E Public HTTP access",
        type: "public",
        config: { permissions: ["customers.read", "customers.write"] },
      }),
    })
  ).body;
else
  await json(
    `${control}/runtime-endpoints/${httpEndpoint.id}/auth-policies/${publicPolicy.id}/default`,
    {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
      body: "{}",
    },
  );
assert.equal(publicPolicy.type, "public", "multiple endpoint authentication policies can be assigned");

const removablePolicy = (
  await json(`${control}/runtime-endpoints/${httpEndpoint.id}/auth-policies`, {
    method: "POST",
    headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
    body: JSON.stringify({
      name: `E2E removable authentication ${Date.now()}`,
      type: "public",
      config: { permissions: ["customers.read"] },
    }),
  })
).body;
let authenticationDetail = (
  await json(`${control}/runtime-endpoints/${httpEndpoint.id}`, {
    headers: { cookie },
  })
).body;
const reorderedPolicyIds = [
  removablePolicy.id,
  ...authenticationDetail.assignedAuthPolicies
    .map((policy) => policy.id)
    .filter((policyId) => policyId !== removablePolicy.id),
];
await json(
  `${control}/runtime-endpoints/${httpEndpoint.id}/auth-policies/order`,
  {
    method: "PUT",
    headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
    body: JSON.stringify({ policyIds: reorderedPolicyIds }),
  },
);
authenticationDetail = (
  await json(`${control}/runtime-endpoints/${httpEndpoint.id}`, {
    headers: { cookie },
  })
).body;
assert.equal(
  authenticationDetail.assignedAuthPolicies[0].id,
  removablePolicy.id,
  "endpoint authentication policies can be reordered",
);
const removalResponse = await fetch(
  `${control}/runtime-endpoints/${httpEndpoint.id}/auth-policies/${removablePolicy.id}`,
  {
    method: "DELETE",
    headers: { cookie, "x-csrf-token": csrf },
  },
);
assert.equal(removalResponse.status, 204, "policy removal returns no content");
authenticationDetail = (
  await json(`${control}/runtime-endpoints/${httpEndpoint.id}`, {
    headers: { cookie },
  })
).body;
assert.ok(
  !authenticationDetail.assignedAuthPolicies.some(
    (policy) => policy.id === removablePolicy.id,
  ),
  "endpoint authentication policies can be removed",
);
const projectPolicyRemovalResponse = await fetch(
  `${control}/auth-policies/${removablePolicy.id}`,
  {
    method: "DELETE",
    headers: { cookie, "x-csrf-token": csrf },
  },
);
assert.equal(
  projectPolicyRemovalResponse.status,
  204,
  "an unassigned project authentication policy can be deleted",
);

const functions = await json(`${control}/functions`, { headers: { cookie } });
const searchCustomers = functions.body.find(
  (entry) => entry.slug === "search_customers",
);
assert.ok(searchCustomers, "seeded search_customers project Function exists");
assert.equal(
  searchCustomers.projectId,
  login.body.user.project.id,
  "Function belongs directly to the selected Project",
);
assert.equal(
  "endpointId" in searchCustomers,
  false,
  "reusable Function is not owned by one endpoint",
);
const bindingMap = await json(`${control}/binding-map`, { headers: { cookie } });
assert.ok(
  bindingMap.body.endpoints.some(
    (endpoint) =>
      endpoint.kind === "mcp" &&
      endpoint.mcpToolBindings.some(
        (binding) => binding.functionId === searchCustomers.id,
      ),
  ),
  "binding map returns project-scoped Function-to-endpoint connections",
);

const deploy = await json(`${control}/deployments`, {
  method: "POST",
  headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
  body: "{}",
});
await waitForDeployment(deploy.body.id, cookie);
const activeDevelopmentDeployments = await json(
  `${control}/deployments?status=active&limit=100`,
  { headers: { cookie } },
);
assert.equal(
  activeDevelopmentDeployments.body.items.filter(
    (item) => item.environment.slug === "development",
  ).length,
  1,
  "development keeps exactly one active Project deployment",
);

const savedOnlyFunction = await ensureFunction({
  name: "e2e_saved_only",
  slug: "e2e_saved_only",
  description: "Tests an immutable saved development version before deployment",
  code: 'export default async function handler(_ctx, input) { return { savedDevelopment: true, value: input.value }; }',
  inputSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      savedDevelopment: { type: "boolean" },
      value: { type: "string" },
    },
    required: ["savedDevelopment", "value"],
    additionalProperties: false,
  },
  timeoutMs: 5000,
  enabled: true,
  riskLevel: "read",
  requiredPermissions: [],
  secretGrantIds: [],
  cachePolicy: null,
});
const savedOnlyTest = await json(
  `${control}/functions/${savedOnlyFunction.id}/test`,
  {
    method: "POST",
    headers: {
      cookie,
      "x-csrf-token": csrf,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      endpointId: mcpEndpoint.id,
      input: { value: "before-deploy" },
      source: "test",
      caller: { subject: "e2e-editor", permissions: [], claims: {} },
    }),
  },
);
assert.equal(
  savedOnlyTest.body.output.savedDevelopment,
  true,
  "saved development Function version is testable before deployment",
);
assert.equal(
  savedOnlyTest.body.executionMode,
  "saved_development_version",
  "Function tests do not execute the active deployed Function artifact",
);
assert.equal(
  savedOnlyTest.body.functionVersion,
  savedOnlyFunction.version,
  "test response identifies the exact saved Function version",
);
const savedOnlyExecutions = await json(
  `${control}/executions?functionId=${savedOnlyFunction.id}`,
  { headers: { cookie } },
);
assert.equal(
  savedOnlyExecutions.body.items[0]?.functionVersion,
  savedOnlyFunction.version,
  "execution records persist the tested Function version separately",
);

const productionRelease = await json(`${control}/deployments/release`, {
  method: "POST",
  headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
  body: JSON.stringify({ sourceProjectDeploymentId: deploy.body.id }),
});
assert.equal(
  productionRelease.body.sourceProjectDeploymentId,
  deploy.body.id,
  "production release pins the completed development deployment",
);
assert.equal(
  productionRelease.body.version,
  deploy.body.version,
  "production keeps the promoted development project version",
);

const mcpHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "x-api-key": apiKey,
};
const tools = await json(`${runtime}/mcp-dev/acme/customer-operations`, {
  method: "POST",
  headers: mcpHeaders,
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  }),
});
assert.ok(
  tools.body.result.tools.some((tool) => tool.name === "search_customers"),
  "tools/list exposes search_customers",
);
assert.equal(
  tools.body.result.tools.some((tool) => tool.name === "e2e_saved_only"),
  false,
  "saved-only Function is not exposed by the active public snapshot",
);
const productionTools = await json(
  `${productionRuntime}/mcp/acme/customer-operations`,
  {
    method: "POST",
    headers: {
      ...mcpHeaders,
      "x-mcpops-environment": "production",
      "x-api-key": productionApiKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 101,
      method: "tools/list",
      params: {},
    }),
  },
);
assert.ok(
  productionTools.body.result.tools.some(
    (tool) => tool.name === "search_customers",
  ),
  "production serves the promoted immutable project release",
);
const productionCall = await json(
  `${productionRuntime}/mcp/acme/customer-operations`,
  {
    method: "POST",
    headers: {
      ...mcpHeaders,
      "x-mcpops-environment": "production",
      "x-api-key": productionApiKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 102,
      method: "tools/call",
      params: { name: "search_customers", arguments: { query: "ada" } },
    }),
  },
);
assert.equal(
  productionCall.body.result.isError,
  false,
  `production tools/call succeeds: ${JSON.stringify(productionCall.body.result.structuredContent)}`,
);
assert.equal(
  productionCall.body.result.structuredContent.release,
  "v2",
  "production executes the released Function version",
);
const call = await json(`${runtime}/mcp-dev/acme/customer-operations`, {
  method: "POST",
  headers: mcpHeaders,
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "search_customers",
      arguments: { query: "ada", limit: 10 },
    },
  }),
});
assert.equal(call.body.result.isError, false, "tools/call succeeds");
assert.equal(
  call.body.result.structuredContent.release,
  "v2",
  "active deployment exposes the seeded v2 behavior marker",
);

const route = await json(
  `${runtime}/http-dev/acme/customer-operations/v1/customers/search?query=ada&limit=10`,
  {},
);
assert.ok(
  Array.isArray(route.body.customers),
  "public HTTP route returns structured customer data without credentials",
);
assert.equal(
  route.body.release,
  "v2",
  "HTTP and MCP use the same active snapshot",
);

const customerId = `e2e-${Date.now()}`;
const noteUrl = `${runtime}/http-dev/acme/customer-operations/v1/customers/${customerId}/note`;
const noteHeaders = { "content-type": "application/json", "x-api-key": apiKey };
await json(`${runtime}/mcp-dev/acme/customer-operations`, {
  method: "POST",
  headers: mcpHeaders,
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: {
      name: "update_customer_note",
      arguments: {
        customerId,
        note: "First durable note",
        confirmation: true,
      },
    },
  }),
});
const repeatedNote = await json(noteUrl, {
  method: "POST",
  headers: noteHeaders,
  body: JSON.stringify({ note: "Second durable note", confirmation: true }),
});
assert.equal(
  repeatedNote.body.previousNotePresent,
  true,
  "HTTP API observes Function state written through the MCP Endpoint",
);

const mcpExecutions = await json(`${control}/executions?endpointId=${mcpEndpoint.id}`, {
  headers: { cookie },
});
assert.ok(
  mcpExecutions.body.items.some((entry) => entry.invocationSource === "mcp"),
  "MCP execution was persisted",
);
const loggedMcpExecution = mcpExecutions.body.items.find(
  (entry) =>
    entry.invocationSource === "mcp" &&
    entry.functionId === searchCustomers.id &&
    entry.status === "success" &&
    entry.requestId,
);
assert.ok(loggedMcpExecution, "MCP execution exposes a request ID for log correlation");
const runtimeLogs = await json(
  `${control}/logs?requestId=${encodeURIComponent(loggedMcpExecution.requestId)}`,
  { headers: { cookie } },
);
assert.ok(
  runtimeLogs.body.items.some(
    (entry) =>
      entry.requestId === loggedMcpExecution.requestId &&
      entry.message === "Searching customers",
  ),
  "redacted structured Function logs were persisted and are queryable by request ID",
);
const httpExecutions = await json(`${control}/executions?endpointId=${httpEndpoint.id}`, {
  headers: { cookie },
});
assert.ok(
  httpExecutions.body.items.some((entry) => entry.invocationSource === "http"),
  "HTTP execution was persisted",
);
const audit = await json(`${control}/audit-events`, { headers: { cookie } });
assert.ok(
  audit.body.items.some(
    (entry) =>
      entry.action === "customer.note.updated" && entry.targetId === customerId,
  ),
  "durable write emitted its immutable domain audit event",
);

const deploymentList = await json(`${control}/deployments`, {
  headers: { cookie },
});
const versionOne = deploymentList.body.items.find(
  (entry) =>
    entry.environment.slug === "development" && entry.version === 1,
);
assert.ok(versionOne, "seeded immutable v1 rollback release exists");
await json(`${control}/deployments/${versionOne.id}/rollback`, {
  method: "POST",
  headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
  body: "{}",
});
const rolledBack = await json(`${runtime}/mcp-dev/acme/customer-operations`, {
  method: "POST",
  headers: mcpHeaders,
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "search_customers",
      arguments: { query: "ada", limit: 10 },
    },
  }),
});
assert.equal(
  rolledBack.body.result.structuredContent.release,
  "v1",
  "rollback switches runtime behavior to the earlier immutable snapshot",
);
const productionAfterDevelopmentRollback = await json(
  `${productionRuntime}/mcp/acme/customer-operations`,
  {
    method: "POST",
    headers: {
      ...mcpHeaders,
      "x-mcpops-environment": "production",
      "x-api-key": productionApiKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 103,
      method: "tools/call",
      params: { name: "search_customers", arguments: { query: "ada" } },
    }),
  },
);
assert.equal(
  productionAfterDevelopmentRollback.body.result.structuredContent.release,
  "v2",
  "development rollback does not change the active production release",
);

async function ensureFunction(spec) {
  const current = await json(`${control}/functions`, { headers: { cookie } });
  const existing = current.body.find((entry) => entry.slug === spec.slug);
  if (existing) {
    const saved = await json(`${control}/functions/${existing.id}`, {
      method: "PATCH",
      headers: {
        cookie,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({ description: spec.description }),
    });
    assert.equal(
      saved.body.description,
      spec.description,
      "project Function metadata saves through the project API",
    );
    return saved.body;
  }
  return (
    await json(`${control}/functions`, {
      method: "POST",
      headers: {
        cookie,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify(spec),
    })
  ).body;
}

const composedLeaf = await ensureFunction({
  name: "e2e_double_value",
  slug: "e2e_double_value",
  description: "Stable E2E internal-call leaf fixture",
  code: "export default async function handler(_ctx, input) { return { value: input.value * 2 }; }",
  inputSchema: {
    type: "object",
    properties: { value: { type: "number" } },
    required: ["value"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { value: { type: "number" } },
    required: ["value"],
    additionalProperties: false,
  },
  timeoutMs: 5000,
  enabled: true,
  riskLevel: "read",
  requiredPermissions: [],
  secretGrantIds: [],
  cachePolicy: null,
});
const composedEntry = await ensureFunction({
  name: "e2e_composed_value",
  slug: "e2e_composed_value",
  description: "Stable E2E internal-call entry fixture",
  code: 'export default async function handler(ctx, input) { return ctx.functions.call("e2e_double_value", input); }',
  inputSchema: {
    type: "object",
    properties: { value: { type: "number" } },
    required: ["value"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { value: { type: "number" } },
    required: ["value"],
    additionalProperties: false,
  },
  timeoutMs: 5000,
  enabled: true,
  riskLevel: "read",
  requiredPermissions: [],
  secretGrantIds: [],
  cachePolicy: null,
});
assert.notEqual(
  composedLeaf.id,
  composedEntry.id,
  "composition uses distinct reusable Functions",
);

const endpointDetail = await json(`${control}/runtime-endpoints/${mcpEndpoint.id}`, {
  headers: { cookie },
});
if (
  !endpointDetail.body.mcpBindings.some(
    (binding) => binding.toolName === "e2e_composed_value",
  )
) {
  await json(`${control}/runtime-endpoints/${mcpEndpoint.id}/mcp-bindings`, {
    method: "POST",
    headers: {
      cookie,
      "x-csrf-token": csrf,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      functionId: composedEntry.id,
      toolName: "e2e_composed_value",
      title: "E2E composed value",
      description: "Exercises a pinned internal Function call",
      enabled: true,
    }),
  });
}

// Prove that a project Function is reusable across independently deployed
// runtime endpoints. The secondary endpoint remains a draft because runtime behavior is
// already covered by the primary endpoint below.
const reuseSlug = "e2e-reuse-service";
const latestEndpoints = await json(`${control}/runtime-endpoints`, {
  headers: { cookie },
});
let reuseEndpoint = latestEndpoints.body.find(
  (entry) => entry.kind === "mcp" && entry.slug === reuseSlug,
);
if (!reuseEndpoint) {
  reuseEndpoint = (
    await json(`${control}/runtime-endpoints`, {
      method: "POST",
      headers: {
        cookie,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "mcp",
        name: "E2E Reuse MCP Endpoint",
        slug: reuseSlug,
        description: "Verifies project Function reuse across runtime endpoints",
      }),
    })
  ).body;
}
const reuseDetail = await json(`${control}/runtime-endpoints/${reuseEndpoint.id}`, {
  headers: { cookie },
});
if (
  !reuseDetail.body.mcpBindings.some(
    (binding) => binding.toolName === "e2e_composed_value",
  )
) {
  await json(`${control}/runtime-endpoints/${reuseEndpoint.id}/mcp-bindings`, {
    method: "POST",
    headers: {
      cookie,
      "x-csrf-token": csrf,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      functionId: composedEntry.id,
      toolName: "e2e_composed_value",
      title: "E2E composed value",
      description: "Reuses the same project Function in a second endpoint",
      enabled: true,
    }),
  });
}
const reusedFunctions = await json(`${control}/functions`, {
  headers: { cookie },
});
const reusedEntry = reusedFunctions.body.find(
  (entry) => entry.id === composedEntry.id,
);
assert.deepEqual(
  new Set(reusedEntry.usages.map((usage) => usage.endpointId)),
  new Set([mcpEndpoint.id, reuseEndpoint.id]),
  "one project Function can be bound to two runtime endpoints",
);
await json(
  `${control}/runtime-endpoints/${reuseEndpoint.id}/auth-policies/${seededDefaultPolicy.id}/default`,
  {
    method: "POST",
    headers: {
      cookie,
      "x-csrf-token": csrf,
      "content-type": "application/json",
    },
    body: "{}",
  },
);
const composedDeployment = await json(
  `${control}/deployments`,
  {
    method: "POST",
    headers: {
      cookie,
      "x-csrf-token": csrf,
      "content-type": "application/json",
    },
    body: "{}",
  },
);
await waitForDeployment(composedDeployment.body.id, cookie);
const composedCall = await json(`${runtime}/mcp-dev/acme/customer-operations`, {
  method: "POST",
  headers: mcpHeaders,
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "e2e_composed_value", arguments: { value: 21 } },
  }),
});
assert.equal(
  composedCall.body.result.structuredContent.value,
  42,
  "ctx.functions.call executes the pinned child Function",
);
const internalExecutions = await json(
  `${control}/executions?functionId=${composedLeaf.id}`,
  { headers: { cookie } },
);
const childExecution = internalExecutions.body.items.find(
  (entry) => entry.invocationSource === "internal",
);
assert.ok(
  childExecution?.parentExecutionId,
  "internal execution records its parent execution",
);
assert.ok(
  childExecution?.rootExecutionId,
  "internal execution records its root execution",
);

const projectSlug = `e2e-project-${Date.now()}`;
const createdProject = await json(`${control}/projects`, {
  method: "POST",
  headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
  body: JSON.stringify({
    name: "E2E Project",
    slug: projectSlug,
    description: "Temporary Project CRUD fixture",
  }),
});
assert.equal(
  createdProject.body._count,
  undefined,
  "project create returns the project resource",
);
const projects = await json(`${control}/projects`, { headers: { cookie } });
const listedProject = projects.body.find(
  (entry) => entry.id === createdProject.body.id,
);
assert.equal(
  listedProject?._count.environments,
  2,
  "new projects receive development and production environments",
);
await fetch(`${control}/projects/${createdProject.body.id}`, {
  method: "DELETE",
  headers: { cookie, "x-csrf-token": csrf },
}).then((response) => {
  assert.equal(
    response.status,
    204,
    "an empty unselected project can be deleted",
  );
});

const e2eEmail = `e2e-user-${Date.now()}@acme.test`;
const createdUser = await json(`${control}/users`, {
  method: "POST",
  headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
  body: JSON.stringify({
    email: e2eEmail,
    temporaryPassword: "TemporaryPass123!",
    role: "viewer",
  }),
});
assert.equal(
  createdUser.body.mustChangePassword,
  true,
  "new local users must replace their temporary password",
);
const temporaryLogin = await json(`${control}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: e2eEmail, password: "TemporaryPass123!" }),
});
assert.equal(
  temporaryLogin.body.user.mustChangePassword,
  true,
  "temporary-password state is returned at login",
);
const disabledUser = await json(`${control}/users/${createdUser.body.id}`, {
  method: "PATCH",
  headers: { cookie, "x-csrf-token": csrf, "content-type": "application/json" },
  body: JSON.stringify({ active: false }),
});
assert.equal(
  disabledUser.body.active,
  false,
  "owner can remove a local user's access without erasing audit identity",
);
console.log("MCP Ops Studio end-to-end test passed.");
