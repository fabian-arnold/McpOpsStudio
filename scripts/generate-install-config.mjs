import { randomBytes } from "node:crypto";
import {
  chmod,
  chown,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const required = [
  "MCP_OPS_MASTER_KEY",
  "SESSION_SECRET",
  "CSRF_SECRET",
  "INTERNAL_API_TOKEN",
  "POSTGRES_ADMIN_PASSWORD",
  "POSTGRES_PASSWORD",
  "MCP_OPS_SETUP_CODE",
];

export async function ensureInstallConfig(
  directory,
  {
    postgresInitTemplate = "/usr/local/share/mcpops/00-security.sh",
    ownerUid = 70,
    ownerGid = 70,
    log = console.log,
  } = {},
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const runtimePath = join(directory, "runtime.env");
  let values;
  try {
    values = parseEnvironment(await readFile(runtimePath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const existing = await readdir(directory);
    if (existing.length > 0)
      throw new Error(
        "Installation configuration is incomplete; restore the config volume from backup instead of regenerating it.",
      );
    values = Object.fromEntries(
      required.map((name) => [
        name,
        name === "MCP_OPS_SETUP_CODE"
          ? randomBytes(18).toString("base64url")
          : randomBytes(32).toString("hex"),
      ]),
    );
    const temporaryPath = `${runtimePath}.tmp`;
    await writeFile(
      temporaryPath,
      `${required.map((name) => `${name}=${values[name]}`).join("\n")}\n`,
      { mode: 0o600 },
    );
    await rename(temporaryPath, runtimePath);
    await writeSecretFile(
      join(directory, "postgres-admin-password"),
      values.POSTGRES_ADMIN_PASSWORD,
    );
    await writeSecretFile(
      join(directory, "postgres-app-password"),
      values.POSTGRES_PASSWORD,
    );
    await copyFile(postgresInitTemplate, join(directory, "00-security.sh"));
    await chmod(join(directory, "00-security.sh"), 0o700);
    for (const path of [
      runtimePath,
      join(directory, "postgres-admin-password"),
      join(directory, "postgres-app-password"),
      join(directory, "00-security.sh"),
    ]) {
      await chown(path, ownerUid, ownerGid);
    }
  }

  for (const name of required) {
    if (!values[name])
      throw new Error(`Installation configuration is missing ${name}.`);
  }
  log(`MCP Ops Studio setup code: ${values.MCP_OPS_SETUP_CODE}`);
  log("Open the installation through HTTPS and continue at /setup.");
  return values;

  async function writeSecretFile(path, value) {
    await writeFile(path, `${value}\n`, { mode: 0o600 });
  }
}

export function parseEnvironment(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) throw new Error("Invalid installation configuration.");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await ensureInstallConfig(process.argv[2] ?? "/var/lib/mcpops-config");
}
