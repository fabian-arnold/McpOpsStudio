import { spawnSync } from "node:child_process";
import process from "node:process";
import * as prettier from "prettier";

const staged = spawnSync(
  "git",
  ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
  { encoding: "utf8" },
);

if (staged.status !== 0) {
  process.stderr.write(staged.stderr || "Unable to list staged files.\n");
  process.exit(1);
}

const paths = staged.stdout.split("\0").filter(Boolean);
const invalid = [];
const prettierConfig = (await prettier.resolveConfig("package.json")) ?? {};

for (const path of paths) {
  const info = await prettier.getFileInfo(path, {
    ignorePath: ".prettierignore",
  });
  if (info.ignored || !info.inferredParser) continue;

  const stagedFile = spawnSync("git", ["show", `:${path}`], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (stagedFile.status !== 0) {
    process.stderr.write(stagedFile.stderr || `Unable to read staged file: ${path}\n`);
    process.exit(1);
  }

  if (
    !(await prettier.check(stagedFile.stdout, {
      ...prettierConfig,
      filepath: path,
    }))
  ) {
    invalid.push(path);
  }
}

if (invalid.length) {
  process.stderr.write("Prettier formatting is required for staged files:\n");
  for (const path of invalid) process.stderr.write(`  ${path}\n`);
  process.stderr.write("Run `pnpm format`, then stage the formatted files again.\n");
  process.exit(1);
}

process.stdout.write(
  paths.length ? "Staged files are formatted.\n" : "No staged files to check.\n",
);
