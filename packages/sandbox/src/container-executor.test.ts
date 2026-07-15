import { describe, expect, it } from "vitest";
import type { RuntimeContext, ScopedCache, ScopedStorage } from "@mcpops/runtime-sdk";
import {
  buildContainerRunArguments,
  cleanupContainer,
  createFunctionExecutorFromEnvironment,
  DisposableContainerExecutor,
  parseContainerExecutorConfig,
  type ContainerProcessAdapter,
} from "./container-executor.js";

const config = {
  dockerBinary: "docker",
  image: "registry.example/mcpops-runner:1.0.0",
  runtime: "runsc",
  memoryMb: 256,
  cpus: 0.5,
  pidsLimit: 64,
  tmpfsMb: 16,
  user: "65532:65532",
  workRoot: "/runtime-work",
  hostWorkRoot: "/host-work",
} as const;
describe("disposable-container executor security", () => {
  it("constructs a no-network, read-only, non-root, capability-free command with quotas", () => {
    const args = buildContainerRunArguments(config, "mcpops-exec-id", "/tmp/work");
    expect(args).toEqual(
      expect.arrayContaining([
        "--network=none",
        "--read-only",
        "--user=65532:65532",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges:true",
        "--pids-limit=64",
        "--memory=256m",
        "--cpus=0.5",
        "--runtime=runsc",
        "--pull=never",
      ]),
    );
    expect(
      args.some((arg) => arg.startsWith("--tmpfs=/tmp:rw,noexec,nosuid,nodev")),
    ).toBe(true);
    expect(args).not.toContain("--privileged");
    expect(args).not.toContain("--network=host");
  });
  it("fails closed on production defaults and missing container configuration", async () => {
    await expect(
      createFunctionExecutorFromEnvironment({ NODE_ENV: "production" }),
    ).rejects.toThrow(/explicitly set/);
    expect(() =>
      parseContainerExecutorConfig({ EXECUTOR_PROVIDER: "container" }),
    ).toThrow(/IMAGE/);
  });
  it("checks daemon/image prerequisites and always exposes explicit provider metadata", async () => {
    const calls: string[][] = [];
    const adapter: ContainerProcessAdapter = {
      spawnAttached() {
        throw new Error("not used");
      },
      async run(_command, args) {
        calls.push([...args]);
        return {
          exitCode: 0,
          stdout: args[0] === "info" ? '{"runsc":{}}' : "",
          stderr: "",
        };
      },
    };
    const executor = await createFunctionExecutorFromEnvironment(
      {
        EXECUTOR_PROVIDER: "container",
        CONTAINER_EXECUTOR_IMAGE: config.image,
        CONTAINER_EXECUTOR_RUNTIME: "runsc",
      },
      adapter,
    );
    expect(executor.metadata).toMatchObject({
      provider: "container",
      runtime: "runsc",
      image: config.image,
    });
    expect(calls).toEqual([
      ["version", "--format", "{{.Server.Version}}"],
      ["image", "inspect", config.image],
      ["info", "--format", "{{json .Runtimes}}"],
    ]);
  });
  it("uses force cleanup as a best-effort terminal path", async () => {
    const calls: string[][] = [];
    const adapter: ContainerProcessAdapter = {
      spawnAttached() {
        throw new Error("not used");
      },
      async run(_command, args) {
        calls.push([...args]);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    await cleanupContainer(adapter, "docker", "mcpops-exec-id");
    expect(calls).toEqual([["rm", "--force", "mcpops-exec-id"]]);
  });
});

it.skipIf(process.env.RUN_CONTAINER_EXECUTOR_TESTS !== "true")(
  "conforms to FunctionExecutor with a real reviewed runner image",
  async () => {
    const executor = new DisposableContainerExecutor(
      parseContainerExecutorConfig(process.env),
    );
    await executor.ensureAvailable();
    const controller = new AbortController();
    const result = await executor.execute({
      compiledCode: `export default async function (_ctx, input) { return { value: input.value + 1 }; }`,
      input: { value: 1 },
      context: context(controller),
      timeoutMs: 5_000,
      abortController: controller,
    });
    expect(result).toMatchObject({ status: "success", output: { value: 2 } });
  },
);

function context(controller: AbortController): RuntimeContext {
  const storage: ScopedStorage = {
    async get() {
      return null;
    },
    async list() {
      return [];
    },
    async set() {},
    async delete() {},
    async deleteMany() {
      return 0;
    },
    forTenant() {
      return this;
    },
  };
  const cache: ScopedCache = {
    async get() {
      return null;
    },
    async set() {},
    async delete() {},
    forTenant() {
      return this;
    },
    async getOrSet(_key, producer) {
      return producer();
    },
  };
  return {
    invocation: { source: "test", requestId: "container-test" },
    trigger: {
      type: "endpoint",
      source: "test",
      endpoint: { kind: "mcp", id: "s", slug: "svc", name: "Service" },
    },
    project: { id: "o", slug: "o", name: "Org" },
    environment: { id: "e", slug: "dev", name: "Dev" },
    endpoint: { kind: "mcp", id: "s", slug: "svc", name: "Service" },
    function: { id: "f", name: "test", riskLevel: "read" },
    caller: { permissions: [], claims: {} },
    permissions: [],
    env: {},
    secrets: {
      get() {
        throw new Error("not granted");
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    http: {
      async request() {
        return { status: 200, headers: {}, data: null };
      },
    },
    storage,
    cache,
    audit: { async write() {} },
    db: {
      async query() {
        return null;
      },
    },
    functions: { call: async () => null },
    collections: {
      collection() {
        throw new Error("not granted");
      },
    },
    abortSignal: controller.signal,
  };
}
