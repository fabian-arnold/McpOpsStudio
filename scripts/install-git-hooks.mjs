import { copyFile, chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const repositoryRoot = process.cwd();
const gitDirectory = spawnSync("git", ["rev-parse", "--absolute-git-dir"], {
  cwd: repositoryRoot,
  encoding: "utf8",
});

if (gitDirectory.status !== 0) {
  process.stderr.write(
    gitDirectory.stderr || "Git hooks can only be installed from a Git checkout.\n",
  );
  process.exit(1);
}

const hooksDirectory = path.join(gitDirectory.stdout.trim(), "hooks");
const source = path.join(repositoryRoot, ".githooks", "pre-commit");
const destination = path.join(hooksDirectory, "pre-commit");

await mkdir(hooksDirectory, { recursive: true });
await copyFile(source, destination);
await chmod(destination, 0o755);

// Use Git's default hooks directory so the checked-in template does not need an
// executable worktree bit on platforms that do not preserve POSIX file modes.
spawnSync("git", ["config", "--local", "--unset-all", "core.hooksPath"], {
  cwd: repositoryRoot,
  stdio: "ignore",
});

process.stdout.write(`Installed pre-commit hook at ${destination}\n`);
