import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  asSafeRuntimeError,
  SafeRuntimeError,
  type InternalRuntimeErrorShape,
} from "@mcpops/runtime-sdk";
import {
  dispatchCapability,
  LocalChildProcessExecutor,
  serializeContext,
  type ExecutorMetadata,
  type FunctionExecutionRequest,
  type FunctionExecutionResult,
  type FunctionExecutor,
} from "./executor.js";

export type ContainerExecutorConfig = {
  dockerBinary: string;
  image: string;
  runtime?: string;
  memoryMb: number;
  cpus: number;
  pidsLimit: number;
  tmpfsMb: number;
  user: string;
  workRoot: string;
  hostWorkRoot: string;
};
export interface ContainerProcessAdapter {
  spawnAttached(
    command: string,
    args: readonly string[],
  ): ChildProcessWithoutNullStreams;
  run(
    command: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}
export class NodeContainerProcessAdapter implements ContainerProcessAdapter {
  spawnAttached(
    command: string,
    args: readonly string[],
  ): ChildProcessWithoutNullStreams {
    return spawn(command, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  }
  run(
    command: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        if (stdout.length < 16_384) stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < 4_096) stderr += chunk.toString("utf8");
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Container command timed out"));
      }, timeoutMs);
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  }
}

export class DisposableContainerExecutor implements FunctionExecutor {
  readonly metadata: ExecutorMetadata;
  constructor(
    readonly config: ContainerExecutorConfig,
    private readonly adapter: ContainerProcessAdapter = new NodeContainerProcessAdapter(),
  ) {
    this.metadata = {
      provider: "container",
      isolation: "disposable-container",
      runtime: config.runtime ?? "default",
      image: config.image,
    };
  }
  async ensureAvailable(): Promise<void> {
    const version = await this.adapter.run(
      this.config.dockerBinary,
      ["version", "--format", "{{.Server.Version}}"],
      5_000,
    );
    if (version.exitCode !== 0)
      throw new Error("Container executor cannot reach the configured Docker daemon");
    const image = await this.adapter.run(
      this.config.dockerBinary,
      ["image", "inspect", this.config.image],
      5_000,
    );
    if (image.exitCode !== 0)
      throw new Error(
        "Container executor image is not present; pull and review it before startup",
      );
    if (this.config.runtime) {
      const runtimes = await this.adapter.run(
        this.config.dockerBinary,
        ["info", "--format", "{{json .Runtimes}}"],
        5_000,
      );
      if (
        runtimes.exitCode !== 0 ||
        !runtimes.stdout.includes(`"${this.config.runtime}"`)
      )
        throw new Error(
          `Container executor runtime '${this.config.runtime}' is not installed`,
        );
    }
  }
  async execute(request: FunctionExecutionRequest): Promise<FunctionExecutionResult> {
    const startedAt = performance.now();
    await mkdir(this.config.workRoot, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(
      join(this.config.workRoot, "mcpops-container-execution-"),
    );
    await chmod(directory, 0o755);
    const modulePath = join(directory, "function.mjs");
    await writeFile(modulePath, request.compiledCode, {
      encoding: "utf8",
      mode: 0o644,
    });
    const name = `mcpops-exec-${randomUUID()}`;
    const adjacentRunner = fileURLToPath(
      new URL("./container-runner.js", import.meta.url),
    );
    const runnerPath = existsSync(adjacentRunner)
      ? adjacentRunner
      : fileURLToPath(new URL("../dist/container-runner.js", import.meta.url));
    await copyFile(runnerPath, join(directory, "container-runner.mjs"));
    const args = buildContainerRunArguments(
      this.config,
      name,
      join(this.config.hostWorkRoot, basename(directory)),
    );
    const child = this.adapter.spawnAttached(this.config.dockerBinary, args);
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const result = await new Promise<FunctionExecutionResult>((resolve) => {
      let settled = false;
      let cancellation: FunctionExecutionResult | undefined;
      let grace: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: FunctionExecutionResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (grace) clearTimeout(grace);
        request.context.abortSignal.removeEventListener("abort", cancel);
        lines.close();
        child.kill("SIGKILL");
        void cleanupContainer(this.adapter, this.config.dockerBinary, name).finally(
          () => resolve(value),
        );
      };
      const timeoutResult = (): FunctionExecutionResult => ({
        status: "timeout",
        durationMs: Math.round(performance.now() - startedAt),
        error: new SafeRuntimeError({
          code: "TIMEOUT",
          message: "The function exceeded its time limit.",
          requestId: request.context.invocation.requestId,
        }).toJSON(),
      });
      const send = (value: unknown): void => {
        if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(value) + "\n");
      };
      const cancel = (): void => {
        if (settled || cancellation) return;
        cancellation = timeoutResult();
        request.abortController?.abort(
          new DOMException("Function execution cancelled", "AbortError"),
        );
        send({ type: "cancel", reason: "Function execution cancelled" });
        grace = setTimeout(() => finish(cancellation as FunctionExecutionResult), 250);
      };
      const timer = setTimeout(cancel, Math.max(1, request.timeoutMs));
      request.context.abortSignal.addEventListener("abort", cancel, { once: true });
      lines.on("line", (line) => {
        let raw: ContainerMessage;
        try {
          raw = JSON.parse(line) as ContainerMessage;
        } catch {
          finish(internalResult(request, startedAt));
          return;
        }
        if (raw.type === "ready")
          send({
            type: "execute",
            moduleUrl: "file:///workspace/function.mjs",
            input: request.input,
            context: serializeContext(request.context),
          });
        else if (raw.type === "rpc")
          void dispatchCapability(request.context, raw.operation, raw.args).then(
            (value) => send({ type: "rpc-result", id: raw.id, value }),
            (error: unknown) =>
              send({
                type: "rpc-error",
                id: raw.id,
                error: asSafeRuntimeError(
                  error,
                  request.context.invocation.requestId,
                ).toDiagnosticJSON(),
              }),
          );
        else if (raw.type === "result")
          finish(
            cancellation ?? {
              status: "success",
              output: raw.output,
              durationMs: Math.round(performance.now() - startedAt),
            },
          );
        else if (raw.type === "error")
          finish(
            cancellation ?? {
              status: raw.error.code === "TIMEOUT" ? "timeout" : "error",
              error: normalizeContainerError(
                raw.error,
                request.context.invocation.requestId,
              ).toDiagnosticJSON(),
              durationMs: Math.round(performance.now() - startedAt),
            },
          );
      });
      child.on("error", () => finish(internalResult(request, startedAt)));
      child.on("exit", () => {
        if (!settled) finish(cancellation ?? internalResult(request, startedAt));
      });
    });
    await rm(directory, { recursive: true, force: true });
    return result;
  }
}
type ContainerMessage =
  | { type: "ready" }
  | { type: "result"; output: unknown }
  | {
      type: "error";
      error: {
        code?: string;
        message?: string;
        requestId?: string;
        retryable?: boolean;
        diagnostic?: InternalRuntimeErrorShape["diagnostic"];
      };
    }
  | { type: "rpc"; id: number; operation: string; args: unknown[] };
export function buildContainerRunArguments(
  config: ContainerExecutorConfig,
  name: string,
  workspacePath: string,
): string[] {
  return [
    "run",
    "--rm",
    "--interactive",
    "--pull=never",
    `--name=${name}`,
    "--network=none",
    "--read-only",
    `--user=${config.user}`,
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    `--pids-limit=${config.pidsLimit}`,
    `--memory=${config.memoryMb}m`,
    `--cpus=${config.cpus}`,
    "--init",
    "--stop-timeout=1",
    `--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=${config.tmpfsMb}m`,
    `--mount=type=bind,src=${workspacePath},dst=/workspace,readonly`,
    ...(config.runtime ? [`--runtime=${config.runtime}`] : []),
    config.image,
    "node",
    "--no-addons",
    "--disable-proto=delete",
    "--disallow-code-generation-from-strings",
    "/workspace/container-runner.mjs",
  ];
}
export async function cleanupContainer(
  adapter: ContainerProcessAdapter,
  dockerBinary: string,
  name: string,
): Promise<void> {
  try {
    await adapter.run(dockerBinary, ["rm", "--force", name], 5_000);
  } catch {
    /* best-effort cleanup after daemon/client failure */
  }
}
export function parseContainerExecutorConfig(
  env: NodeJS.ProcessEnv,
): ContainerExecutorConfig {
  const image = env.CONTAINER_EXECUTOR_IMAGE;
  if (!image || !/^[A-Za-z0-9][A-Za-z0-9./:@_-]{1,255}$/.test(image))
    throw new Error("CONTAINER_EXECUTOR_IMAGE must name a pre-pulled reviewed image");
  const runtime = env.CONTAINER_EXECUTOR_RUNTIME;
  if (runtime && !/^[A-Za-z0-9._-]{1,64}$/.test(runtime))
    throw new Error("CONTAINER_EXECUTOR_RUNTIME is invalid");
  return {
    dockerBinary: env.CONTAINER_EXECUTOR_DOCKER_BIN ?? "docker",
    image,
    ...(runtime ? { runtime } : {}),
    memoryMb: boundedInteger(env.CONTAINER_EXECUTOR_MEMORY_MB, 256, 64, 4096, "memory"),
    cpus: boundedNumber(env.CONTAINER_EXECUTOR_CPUS, 0.5, 0.1, 8, "cpus"),
    pidsLimit: boundedInteger(env.CONTAINER_EXECUTOR_PIDS, 64, 16, 512, "pids"),
    tmpfsMb: boundedInteger(env.CONTAINER_EXECUTOR_TMPFS_MB, 16, 1, 256, "tmpfs"),
    user: env.CONTAINER_EXECUTOR_USER ?? "65532:65532",
    workRoot: env.CONTAINER_EXECUTOR_WORK_ROOT ?? tmpdir(),
    hostWorkRoot:
      env.CONTAINER_EXECUTOR_HOST_WORK_ROOT ??
      env.CONTAINER_EXECUTOR_WORK_ROOT ??
      tmpdir(),
  };
}
export async function createFunctionExecutorFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  adapter?: ContainerProcessAdapter,
): Promise<FunctionExecutor> {
  const provider = env.EXECUTOR_PROVIDER;
  if (!provider) {
    if (env.NODE_ENV === "production")
      throw new Error("EXECUTOR_PROVIDER must be explicitly set in production");
    return new LocalChildProcessExecutor();
  }
  if (provider === "local") return new LocalChildProcessExecutor();
  if (provider !== "container")
    throw new Error("EXECUTOR_PROVIDER must be local or container");
  const executor = new DisposableContainerExecutor(
    parseContainerExecutorConfig(env),
    adapter,
  );
  await executor.ensureAvailable();
  return executor;
}
function boundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Container executor ${name} limit is invalid`);
  return value;
}
function boundedNumber(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(`Container executor ${name} limit is invalid`);
  return value;
}
function internalResult(
  request: FunctionExecutionRequest,
  startedAt: number,
): FunctionExecutionResult {
  return {
    status: "error",
    durationMs: Math.round(performance.now() - startedAt),
    error: new SafeRuntimeError({
      code: "INTERNAL_ERROR",
      message: "The function could not be completed.",
      requestId: request.context.invocation.requestId,
    }).toJSON(),
  };
}
function normalizeContainerError(
  value: {
    code?: string;
    message?: string;
    requestId?: string;
    retryable?: boolean;
    diagnostic?: InternalRuntimeErrorShape["diagnostic"];
  },
  requestId: string,
): SafeRuntimeError {
  const allowed = new Set([
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "VALIDATION_ERROR",
    "RATE_LIMITED",
    "TIMEOUT",
    "UPSTREAM_ERROR",
    "CONFIGURATION_ERROR",
  ]);
  const code = allowed.has(value.code ?? "")
    ? (value.code as SafeRuntimeError["code"])
    : "INTERNAL_ERROR";
  return new SafeRuntimeError({
    code,
    message:
      code === "INTERNAL_ERROR"
        ? "The function could not be completed."
        : String(value.message ?? "The function could not be completed."),
    requestId: value.requestId ?? requestId,
    ...(value.retryable === undefined ? {} : { retryable: value.retryable }),
    ...(value.diagnostic === undefined ? {} : { diagnostic: value.diagnostic }),
  });
}
