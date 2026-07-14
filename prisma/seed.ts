import { createHash } from "node:crypto";
import {
  PrismaClient,
  type Prisma,
  RiskLevel,
  HttpMethod,
} from "@prisma/client";
import { encryptSecret } from "../packages/db/src/encryption.ts";
import { hashPassword } from "../packages/db/src/password.ts";

const prisma = new PrismaClient();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

type DemoFunction = {
  slug: string;
  title: string;
  description: string;
  code: string;
  compiledCode: string;
  inputSchema: Prisma.InputJsonValue;
  outputSchema: Prisma.InputJsonValue;
  riskLevel: RiskLevel;
  permissions: string[];
  tool: { name: string; description: string };
  route: {
    method: HttpMethod;
    path: string;
    inputMapping: Prisma.InputJsonValue;
  };
};

const demos: DemoFunction[] = [
  {
    slug: "search_customers",
    title: "Search customers",
    description: "Searches the development CRM fixture by name or email.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
    outputSchema: {
      type: "object",
      required: ["customers", "release"],
      properties: {
        customers: {
          type: "array",
          items: { type: "object", required: ["id", "name", "email"] },
        },
        release: { type: "string", enum: ["v1", "v2"] },
      },
    },
    riskLevel: RiskLevel.read,
    permissions: ["customers.read"],
    code: `export default async function handler(ctx, input) {
  ctx.logger.info("Searching customers", { query: input.query, tenantId: ctx.tenant?.id });
  const response = await ctx.http.request({
    method: "GET",
    url: ctx.env.CRM_API_URL + "/customers",
    query: { q: input.query, limit: input.limit ?? 10 }
  });
  return { customers: response.data.items, release: "v2" };
}`,
    compiledCode: `export default async function handler(ctx,input){ctx.logger.info("Searching customers",{query:input.query,tenantId:ctx.tenant?.id});const response=await ctx.http.request({method:"GET",url:ctx.env.CRM_API_URL+"/customers",query:{q:input.query,limit:input.limit??10}});return {customers:response.data.items,release:"v2"};}`,
    tool: {
      name: "search_customers",
      description: "Search customers by partial name or email. Read-only.",
    },
    route: {
      method: HttpMethod.GET,
      path: "/v1/customers/search",
      inputMapping: { query: "query" },
    },
  },
  {
    slug: "get_customer",
    title: "Get customer",
    description: "Gets one development CRM customer by ID.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["customerId"],
      properties: { customerId: { type: "string", minLength: 1 } },
    },
    outputSchema: { type: "object", required: ["id", "name", "email"] },
    riskLevel: RiskLevel.read,
    permissions: ["customers.read"],
    code: `export default async function handler(ctx, input) {
  ctx.logger.info("Getting customer", { customerId: input.customerId });
  const response = await ctx.http.request({
    method: "GET",
    url: ctx.env.CRM_API_URL + "/customers/" + encodeURIComponent(input.customerId)
  });
  return response.data;
}`,
    compiledCode: `export default async function handler(ctx,input){ctx.logger.info("Getting customer",{customerId:input.customerId});const response=await ctx.http.request({method:"GET",url:ctx.env.CRM_API_URL+"/customers/"+encodeURIComponent(input.customerId)});return response.data;}`,
    tool: {
      name: "get_customer",
      description:
        "Retrieve one customer by its stable customer ID. Read-only.",
    },
    route: {
      method: HttpMethod.GET,
      path: "/v1/customers/:customerId",
      inputMapping: { customerId: "path.customerId" },
    },
  },
  {
    slug: "update_customer_note",
    title: "Update customer note",
    description:
      "Records a confirmed customer note update and an immutable audit event.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["customerId", "note", "confirmation"],
      properties: {
        customerId: { type: "string", minLength: 1 },
        note: { type: "string", minLength: 1, maxLength: 2000 },
        confirmation: { type: "boolean", const: true },
      },
    },
    outputSchema: {
      type: "object",
      required: ["updated", "customerId", "previousNotePresent"],
    },
    riskLevel: RiskLevel.write,
    permissions: ["customers.write"],
    code: `export default async function handler(ctx, input) {
  if (input.confirmation !== true) throw new Error("Confirmation is required");
  const storageKey = "customer-note:" + input.customerId;
  const previous = await ctx.storage.get(storageKey);
  await ctx.storage.set(storageKey, { note: input.note, updatedAt: new Date().toISOString() });
  await ctx.audit.write({ action: "customer.note.updated", targetType: "customer", targetId: input.customerId, metadata: { noteLength: input.note.length, previousNotePresent: previous !== null } });
  return { updated: true, customerId: input.customerId, previousNotePresent: previous !== null };
}`,
    compiledCode: `export default async function handler(ctx,input){if(input.confirmation!==true)throw new Error("Confirmation is required");const storageKey="customer-note:"+input.customerId;const previous=await ctx.storage.get(storageKey);await ctx.storage.set(storageKey,{note:input.note,updatedAt:new Date().toISOString()});await ctx.audit.write({action:"customer.note.updated",targetType:"customer",targetId:input.customerId,metadata:{noteLength:input.note.length,previousNotePresent:previous!==null}});return {updated:true,customerId:input.customerId,previousNotePresent:previous!==null};}`,
    tool: {
      name: "update_customer_note",
      description:
        "Update a customer note after explicit confirmation. This is a write action.",
    },
    route: {
      method: HttpMethod.POST,
      path: "/v1/customers/:customerId/note",
      inputMapping: {
        customerId: "path.customerId",
        note: "body.note",
        confirmation: "body.confirmation",
      },
    },
  },
  {
    slug: "health_check",
    title: "Health check",
    description:
      "Reports that the function executor can run this handler. This is not a dependency readiness check.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    outputSchema: { type: "object", required: ["status", "runtime"] },
    riskLevel: RiskLevel.read,
    permissions: [],
    code: `export default async function handler(ctx) { return { status: "ok", runtime: "node", endpoint: ctx.endpoint.slug }; }`,
    compiledCode: `module.exports.default = async function handler(ctx){return {status:"ok",runtime:"node",endpoint:ctx.endpoint.slug};};`,
    tool: {
      name: "health_check",
      description:
        "Check that the Customer Operations function executor can run a handler. This does not probe dependencies.",
    },
    route: {
      method: HttpMethod.GET,
      path: "/health/function",
      inputMapping: {},
    },
  },
];

async function main(): Promise<void> {
  const configuredMockCrmUrl = process.env.MOCK_CRM_URL?.trim();
  const mockCrmUrl =
    configuredMockCrmUrl ||
    (process.env.NODE_ENV === "production"
      ? undefined
      : "http://mock-crm:8090");
  if (!mockCrmUrl)
    throw new Error(
      "The development seed requires an explicit MOCK_CRM_URL outside development.",
    );
  const developmentRuntimeUrl =
    process.env.PUBLIC_RUNTIME_URL ??
    process.env.RUNTIME_PUBLIC_URL ??
    "http://localhost:8080";
  const productionRuntimeUrl =
    process.env.PRODUCTION_RUNTIME_PUBLIC_URL ?? developmentRuntimeUrl;
  const project = await prisma.project.upsert({
    where: { slug: "acme" },
    create: {
      name: "Acme",
      slug: "acme",
      description: "Development project",
      status: "active",
    },
    update: {
      name: "Acme",
      description: "Development project",
      status: "active",
    },
  });
  await prisma.installation.upsert({
    where: { id: "installation" },
    create: {
      id: "installation",
      publicUrl:
        process.env.PUBLIC_CONTROL_PLANE_URL ?? "http://localhost:8080",
    },
    update: {},
  });
  const environment = await prisma.environment.upsert({
    where: { projectId_slug: { projectId: project.id, slug: "development" } },
    create: {
      projectId: project.id,
      name: "Development",
      slug: "development",
      capturePayloads: true,
      baseUrl: developmentRuntimeUrl,
      variables: { CRM_API_URL: mockCrmUrl },
    },
    update: {
      name: "Development",
      capturePayloads: true,
      baseUrl: developmentRuntimeUrl,
      variables: { CRM_API_URL: mockCrmUrl },
    },
  });
  const productionEnvironment = await prisma.environment.upsert({
    where: { projectId_slug: { projectId: project.id, slug: "production" } },
    create: {
      projectId: project.id,
      name: "Production",
      slug: "production",
      baseUrl: productionRuntimeUrl,
      variables: { CRM_API_URL: mockCrmUrl },
    },
    update: {
      name: "Production",
      baseUrl: productionRuntimeUrl,
      variables: { CRM_API_URL: mockCrmUrl },
    },
  });
  const preserveActiveDevelopmentDeployment = Boolean(
    environment.activeProjectDeploymentId,
  );
  const passwordHash = await hashPassword(
    process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!",
  );
  const admin = await prisma.user.upsert({
    where: { email: process.env.SEED_ADMIN_EMAIL ?? "admin@acme.test" },
    create: {
      email: process.env.SEED_ADMIN_EMAIL ?? "admin@acme.test",
      passwordHash,
      role: "owner",
      active: true,
      mustChangePassword: false,
    },
    update: {
      passwordHash,
      role: "owner",
      active: true,
      mustChangePassword: false,
    },
  });
  const authPolicy = await prisma.authPolicy.upsert({
    where: {
      projectId_name: {
        projectId: project.id,
        name: "acme-development-api-key",
      },
    },
    create: {
      projectId: project.id,
      name: "acme-development-api-key",
      type: "api_key",
      config: {
        header: "x-api-key",
        secretRef: "MCP_CLIENT_API_KEY",
        permissions: ["customers.read", "customers.write"],
      },
    },
    update: {
      type: "api_key",
      config: {
        header: "x-api-key",
        secretRef: "MCP_CLIENT_API_KEY",
        permissions: ["customers.read", "customers.write"],
      },
    },
  });
  await prisma.secret.upsert({
    where: {
      projectId_environmentId_name: {
        projectId: project.id,
        environmentId: environment.id,
        name: "MCP_CLIENT_API_KEY",
      },
    },
    create: {
      projectId: project.id,
      environmentId: environment.id,
      name: "MCP_CLIENT_API_KEY",
      encryptedValue: encryptSecret(
        process.env.SEED_MCP_API_KEY ?? "dev-acme-mcp-key",
      ),
    },
    update: {},
  });
  await prisma.secret.upsert({
    where: {
      projectId_environmentId_name: {
        projectId: project.id,
        environmentId: productionEnvironment.id,
        name: "MCP_CLIENT_API_KEY",
      },
    },
    create: {
      projectId: project.id,
      environmentId: productionEnvironment.id,
      name: "MCP_CLIENT_API_KEY",
      encryptedValue: encryptSecret(
        process.env.SEED_PRODUCTION_MCP_API_KEY ?? "prod-acme-mcp-key",
      ),
    },
    update: {},
  });
  const upsertEndpoint = async (kind: "mcp" | "http") =>
    prisma.runtimeEndpoint.upsert({
      where: {
        projectId_kind_slug: {
          projectId: project.id,
          kind,
          slug: "customer-operations",
        },
      },
      create: {
        projectId: project.id,
        environmentId: environment.id,
        kind,
        name: "Customer Operations",
        slug: "customer-operations",
        description:
          kind === "mcp"
            ? "Seeded Customer Operations MCP Endpoint"
            : "Seeded Customer Operations HTTP API",
        status: "deployed",
        runtimeVersion: "1",
        runtimeConfig: {
          timeoutMs: 30000,
          maxConcurrentRequests: 20,
          env: { CRM_API_URL: mockCrmUrl },
          endpointAccessPolicy: { mode: "authenticated", allowedSubjects: [] },
        },
        defaultAuthPolicyId: authPolicy.id,
      },
      update: {
        name: "Customer Operations",
        status: "deployed",
        runtimeConfig: {
          timeoutMs: 30000,
          maxConcurrentRequests: 20,
          env: { CRM_API_URL: mockCrmUrl },
          endpointAccessPolicy: { mode: "authenticated", allowedSubjects: [] },
        },
        defaultAuthPolicyId: authPolicy.id,
      },
    });
  const mcpEndpoint = await upsertEndpoint("mcp");
  const httpEndpoint = await upsertEndpoint("http");
  for (const endpoint of [mcpEndpoint, httpEndpoint]) {
    await prisma.endpointAuthPolicy.upsert({
      where: {
        endpointId_authPolicyId: {
          endpointId: endpoint.id,
          authPolicyId: authPolicy.id,
        },
      },
      create: {
        endpointId: endpoint.id,
        authPolicyId: authPolicy.id,
        position: 0,
      },
      update: {},
    });
    await prisma.networkPolicy.upsert({
      where: { endpointId: endpoint.id },
      create: {
        projectId: project.id,
        endpointId: endpoint.id,
        allowedHosts: ["mock-crm"],
        allowedMethods: ["GET", "POST"],
        allowedPorts: [8090],
        allowPrivateHosts: ["mock-crm"],
        maxResponseBytes: 1048576,
      },
      update: {
        allowedHosts: ["mock-crm"],
        allowedMethods: ["GET", "POST"],
        allowedPorts: [8090],
        allowPrivateHosts: ["mock-crm"],
        maxResponseBytes: 1048576,
      },
    });
  }
  await prisma.storageNamespace.upsert({
    where: {
      projectId_environmentId_name: {
        projectId: project.id,
        environmentId: environment.id,
        name: "default",
      },
    },
    create: {
      projectId: project.id,
      environmentId: environment.id,
      name: "default",
    },
    update: {},
  });

  const snapshotFunctions: Prisma.InputJsonObject[] = [];
  const snapshotFunctionsV1: Prisma.InputJsonObject[] = [];
  const snapshotTools: Prisma.InputJsonObject[] = [];
  const snapshotRoutes: Prisma.InputJsonObject[] = [];
  for (const demo of demos) {
    const fn = await prisma.function.upsert({
      where: { projectId_slug: { projectId: project.id, slug: demo.slug } },
      create: {
        projectId: project.id,
        name: demo.slug,
        slug: demo.slug,
        title: demo.title,
        description: demo.description,
        code: demo.code,
        inputSchema: demo.inputSchema,
        outputSchema: demo.outputSchema,
        timeoutMs: 30000,
        enabled: true,
        riskLevel: demo.riskLevel,
        requiredPermissions: demo.permissions,
        version: 2,
      },
      update: {
        title: demo.title,
        description: demo.description,
        code: demo.code,
        inputSchema: demo.inputSchema,
        outputSchema: demo.outputSchema,
        enabled: true,
        riskLevel: demo.riskLevel,
        requiredPermissions: demo.permissions,
        version: 2,
      },
    });
    const v1Code =
      demo.slug === "search_customers"
        ? demo.code.replace('release: "v2"', 'release: "v1"')
        : demo.code;
    const ensureSeedVersion = async (code: string, release: "v1" | "v2") => {
      const sum = hash(code);
      const existing = await prisma.functionVersion.findFirst({
        where: { functionId: fn.id, checksum: sum },
      });
      if (existing) return existing;
      const latest = await prisma.functionVersion.aggregate({
        where: { functionId: fn.id },
        _max: { version: true },
      });
      return prisma.functionVersion.create({
        data: {
          functionId: fn.id,
          version: (latest._max.version ?? 0) + 1,
          code,
          compiledCode: code,
          checksum: sum,
          validationResult: { valid: true, seeded: true, release },
          createdByUserId: admin.id,
        },
      });
    };
    const version1 = await ensureSeedVersion(v1Code, "v1");
    const version2 = await ensureSeedVersion(demo.code, "v2");
    await prisma.function.update({
      where: { id: fn.id },
      data: { version: version2.version },
    });
    const tool = await prisma.mcpToolBinding.upsert({
      where: {
        endpointId_toolName: {
          endpointId: mcpEndpoint.id,
          toolName: demo.tool.name,
        },
      },
      create: {
        endpointId: mcpEndpoint.id,
        functionId: fn.id,
        toolName: demo.tool.name,
        title: demo.title,
        description: demo.tool.description,
        enabled: true,
      },
      update: {
        functionId: fn.id,
        title: demo.title,
        description: demo.tool.description,
        enabled: true,
      },
    });
    const route = await prisma.httpRouteBinding.upsert({
      where: {
        endpointId_method_path: {
          endpointId: httpEndpoint.id,
          method: demo.route.method,
          path: demo.route.path,
        },
      },
      create: {
        endpointId: httpEndpoint.id,
        functionId: fn.id,
        method: demo.route.method,
        path: demo.route.path,
        inputMapping: demo.route.inputMapping,
        enabled: true,
      },
      update: {
        functionId: fn.id,
        inputMapping: demo.route.inputMapping,
        enabled: true,
      },
    });
    const executionMetadata = {
      functionId: fn.id,
      name: fn.name,
      slug: fn.slug,
      riskLevel: fn.riskLevel,
      requiredPermissions: demo.permissions,
      secretGrants: [],
      timeoutMs: fn.timeoutMs,
      inputSchema: demo.inputSchema,
      outputSchema: demo.outputSchema,
      enabled: true,
    };
    snapshotFunctionsV1.push({
      ...executionMetadata,
      versionId: version1.id,
      version: 1,
      checksum: version1.checksum,
      compiledCode: v1Code,
    });
    snapshotFunctions.push({
      ...executionMetadata,
      versionId: version2.id,
      version: 2,
      checksum: version2.checksum,
      compiledCode: demo.code,
    });
    snapshotTools.push({
      id: tool.id,
      functionId: fn.id,
      toolName: tool.toolName,
      title: tool.title,
      description: tool.description,
      enabled: true,
      inputSchema: demo.inputSchema,
    });
    snapshotRoutes.push({
      id: route.id,
      functionId: fn.id,
      method: route.method,
      path: route.path,
      inputMapping: route.inputMapping,
      enabled: true,
    });
  }

  for (const configuration of [
    {
      endpoint: mcpEndpoint,
      mcpBindings: snapshotTools,
      httpBindings: [] as Prisma.InputJsonObject[],
    },
    {
      endpoint: httpEndpoint,
      mcpBindings: [] as Prisma.InputJsonObject[],
      httpBindings: snapshotRoutes,
    },
  ]) {
    const snapshotBase = {
      schemaVersion: 1,
      project: { id: project.id, slug: project.slug, name: project.name },
      environment: {
        id: environment.id,
        slug: environment.slug,
        name: environment.name,
      },
      endpoint: {
        id: configuration.endpoint.id,
        slug: configuration.endpoint.slug,
        name: configuration.endpoint.name,
        kind: configuration.endpoint.kind,
      },
      defaultAuthPolicyId: authPolicy.id,
      env: { CRM_API_URL: mockCrmUrl },
      endpointAccessPolicy: { mode: "authenticated", allowedSubjects: [] },
      mcpBindings: configuration.mcpBindings,
      httpBindings: configuration.httpBindings,
      functionCalls: [],
      libraries: [],
      authPolicies: [
        {
          id: authPolicy.id,
          name: authPolicy.name,
          type: authPolicy.type,
          config: authPolicy.config,
        },
      ],
      capabilities: { reviewedDatabaseQueries: { enabled: false } },
      reviewedQueries: [],
      networkPolicy: {
        allowedHosts: ["mock-crm"],
        allowedMethods: ["GET", "POST"],
        allowedPorts: [8090],
        maxResponseBytes: 1048576,
        allowPrivateHosts: ["mock-crm"],
      },
      secretReferences: ["MCP_CLIENT_API_KEY"],
    };
    const snapshots = [
      {
        release: "v1",
        functions: snapshotFunctionsV1,
        status: "rolled_back" as const,
      },
      {
        release: "v2",
        functions: snapshotFunctions,
        status: "active" as const,
      },
    ];
    const deployments = [];
    let nextVersion =
      (
        await prisma.deployment.aggregate({
          where: { endpointId: configuration.endpoint.id },
          _max: { version: true },
        })
      )._max.version ?? 0;
    for (const item of snapshots) {
      const snapshot = {
        ...snapshotBase,
        seedRelease: item.release,
        functions: item.functions,
      };
      const snapshotChecksum = hash(JSON.stringify(snapshot));
      let deployment = await prisma.deployment.findFirst({
        where: {
          endpointId: configuration.endpoint.id,
          checksum: snapshotChecksum,
        },
      });
      if (!deployment) {
        nextVersion += 1;
        deployment = await prisma.deployment.create({
          data: {
            endpointId: configuration.endpoint.id,
            version: nextVersion,
            status: preserveActiveDevelopmentDeployment
              ? "rolled_back"
              : item.status,
            snapshot: snapshot as Prisma.InputJsonObject,
            runtimeConfig: {
              seedRelease: item.release,
              timeoutMs: 30000,
              maxConcurrentRequests: 20,
              trustedDeveloperExecution: true,
              env: { CRM_API_URL: mockCrmUrl },
              endpointAccessPolicy: snapshotBase.endpointAccessPolicy,
              network: { allowPrivateHosts: ["mock-crm"] },
            },
            checksum: snapshotChecksum,
            completedAt:
              item.release === "v1"
                ? new Date(Date.now() - 3_600_000)
                : new Date(),
          },
        });
        await prisma.deploymentLog.create({
          data: {
            deploymentId: deployment.id,
            level: "info",
            message: `Development seed created immutable ${configuration.endpoint.kind.toUpperCase()} snapshot ${item.release}.`,
          },
        });
      }
      deployments.push(deployment);
    }
    const [rollbackDeployment, activeDeployment] = deployments;
    if (!rollbackDeployment || !activeDeployment)
      throw new Error("Seed deployments were not created");
    if (!preserveActiveDevelopmentDeployment)
      await prisma.$transaction(async (tx) => {
        await tx.deployment.updateMany({
          where: {
            endpointId: configuration.endpoint.id,
            status: "active",
            id: { not: activeDeployment.id },
          },
          data: { status: "rolled_back" },
        });
        await tx.deployment.update({
          where: { id: rollbackDeployment.id },
          data: { status: "rolled_back" },
        });
        await tx.deployment.update({
          where: { id: activeDeployment.id },
          data: { status: "active" },
        });
        await tx.runtimeEndpoint.update({
          where: { id: configuration.endpoint.id },
          data: { activeDeploymentId: activeDeployment.id, status: "deployed" },
        });
      });
  }

  const deploymentEndpoints = await prisma.runtimeEndpoint.findMany({
    where: { projectId: project.id },
    include: {
      deployments: {
        where: { status: { in: ["active", "rolled_back"] } },
        orderBy: { version: "asc" },
      },
    },
    orderBy: [{ kind: "asc" }, { slug: "asc" }],
  });
  let seededActiveProjectDeploymentId: string | undefined;
  for (const version of [1, 2]) {
    const endpointDeployments = deploymentEndpoints.map((endpoint) => {
      const deployment = endpoint.deployments[version - 1];
      if (!deployment)
        throw new Error(`Missing seeded endpoint deployment v${version}`);
      return { endpoint, deployment };
    });
    const snapshot = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      projectId: project.id,
      environmentId: environment.id,
      endpoints: endpointDeployments.map(({ endpoint, deployment }) => ({
        endpointId: endpoint.id,
        deploymentId: deployment.id,
        version: deployment.version,
        checksum: deployment.checksum,
        endpoint: {
          id: endpoint.id,
          name: endpoint.name,
          slug: endpoint.slug,
          kind: endpoint.kind,
        },
        snapshot: deployment.snapshot,
      })),
    };
    const projectDeployment = await prisma.projectDeployment.upsert({
      where: {
        projectId_environmentId_version: {
          projectId: project.id,
          environmentId: environment.id,
          version,
        },
      },
      create: {
        projectId: project.id,
        environmentId: environment.id,
        version,
        status:
          version === 2 && !preserveActiveDevelopmentDeployment
            ? "active"
            : "rolled_back",
        snapshot: snapshot as Prisma.InputJsonObject,
        checksum: hash(JSON.stringify(snapshot)),
        completedAt: new Date(),
      },
      update: {
        snapshot: snapshot as Prisma.InputJsonObject,
        checksum: hash(JSON.stringify(snapshot)),
        completedAt: new Date(),
      },
    });
    await prisma.deployment.updateMany({
      where: { id: { in: endpointDeployments.map(({ deployment }) => deployment.id) } },
      data: { projectDeploymentId: projectDeployment.id },
    });
    if (version === 2) {
      seededActiveProjectDeploymentId = projectDeployment.id;
      if (!preserveActiveDevelopmentDeployment)
        await prisma.environment.update({
          where: { id: environment.id },
          data: { activeProjectDeploymentId: projectDeployment.id },
        });
    }
  }
  const authoritativeActiveProjectDeploymentId =
    environment.activeProjectDeploymentId ?? seededActiveProjectDeploymentId;
  if (authoritativeActiveProjectDeploymentId)
    await prisma.projectDeployment.updateMany({
      where: {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
        id: { not: authoritativeActiveProjectDeploymentId },
      },
      data: { status: "rolled_back" },
    });
}

main()
  .then(() =>
    console.log(
      "Seeded Acme development project and rollback-capable immutable release snapshots.",
    ),
  )
  .finally(async () => prisma.$disconnect());
