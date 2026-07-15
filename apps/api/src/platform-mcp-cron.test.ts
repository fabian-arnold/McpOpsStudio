import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  environment: { findFirst: vi.fn() },
  function: { findFirst: vi.fn() },
  cronBinding: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@mcpops/db", () => ({ prisma: db }));
vi.mock("./resources.js", () => ({
  scheduleQueue: { add: vi.fn(), getJobSchedulers: vi.fn() },
}));

describe("Platform MCP cron tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.environment.findFirst.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Development",
    });
    db.function.findFirst.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Minute task",
      requiredPermissions: ["jobs:run"],
      inputSchema: { type: "object", additionalProperties: false },
    });
    db.cronBinding.findFirst.mockResolvedValue(null);
  });

  it("previews a valid binding without writing", async () => {
    const { callCronTool } = await import("./platform-mcp-cron.js");
    const result = await callCronTool(
      "cron_binding_create",
      "project-1",
      {
        userId: "user-1",
        role: "developer",
        scopes: ["mcpops:read", "mcpops:write"],
      },
      {
        definition: {
          environmentId: "11111111-1111-4111-8111-111111111111",
          functionId: "22222222-2222-4222-8222-222222222222",
          name: "Every minute",
          expression: "* * * * *",
          timezone: "Europe/Berlin",
          serviceSubject: "cron:minute-task",
          permissionGrants: ["jobs:run"],
        },
      },
    );

    expect(result).toMatchObject({
      dryRun: true,
      data: {
        definition: {
          expression: "* * * * *",
          timezone: "Europe/Berlin",
          enabled: true,
        },
      },
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a service identity missing required Function permissions", async () => {
    const { callCronTool } = await import("./platform-mcp-cron.js");
    await expect(
      callCronTool(
        "cron_binding_create",
        "project-1",
        {
          userId: "user-1",
          role: "developer",
          scopes: ["mcpops:read", "mcpops:write"],
        },
        {
          definition: {
            environmentId: "11111111-1111-4111-8111-111111111111",
            functionId: "22222222-2222-4222-8222-222222222222",
            name: "Every minute",
            expression: "* * * * *",
            timezone: "UTC",
            serviceSubject: "cron:minute-task",
            permissionGrants: [],
          },
        },
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SERVICE_PERMISSIONS" });
  });
});
