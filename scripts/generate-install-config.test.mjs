import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureInstallConfig } from "./generate-install-config.mjs";

test("generates a complete stable installation configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcpops-config-"));
  const template = join(root, "template.sh");
  const target = join(root, "config");
  const ownerUid = process.getuid?.() ?? 0;
  const ownerGid = process.getgid?.() ?? 0;
  await writeFile(template, "#!/bin/sh\n", { mode: 0o700 });
  try {
    const first = await ensureInstallConfig(target, {
      postgresInitTemplate: template,
      ownerUid,
      ownerGid,
      log() {},
    });
    const second = await ensureInstallConfig(target, {
      postgresInitTemplate: template,
      ownerUid,
      ownerGid,
      log() {},
    });
    assert.deepEqual(second, first);
    assert.equal(first.MCP_OPS_MASTER_KEY.length, 64);
    assert.equal(
      (await readFile(join(target, "postgres-app-password"), "utf8")).trim(),
      first.POSTGRES_PASSWORD,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to replace partial installation configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcpops-partial-"));
  await writeFile(join(root, "unexpected"), "partial");
  try {
    await assert.rejects(
      ensureInstallConfig(root, { log() {} }),
      /configuration is incomplete/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
