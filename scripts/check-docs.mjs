import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const docsRoot = path.join(root, "docs");
const errors = [];

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".vitepress") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(full)));
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

const manifest = JSON.parse(
  await readFile(path.join(docsRoot, "menu-docs.json"), "utf8"),
);
const shell = await readFile(
  path.join(root, "apps", "web", "components", "shell.tsx"),
  "utf8",
);

for (const entry of manifest) {
  const doc = path.join(docsRoot, entry.doc);
  if (!(await exists(doc))) errors.push(`${entry.label}: missing ${entry.doc}`);
  if (entry.screenshot && !(await exists(path.join(docsRoot, entry.screenshot)))) {
    errors.push(`${entry.label}: missing ${entry.screenshot}`);
  }
  if (!shell.includes(`label: "${entry.label}"`) && !shell.includes(entry.label)) {
    errors.push(`${entry.label}: menu label is not present in AppShell`);
  }
  if (!shell.includes(`href: "${entry.route}"`) && !shell.includes(`href="${entry.route}"`)) {
    errors.push(`${entry.label}: route ${entry.route} is not present in AppShell`);
  }
}

const markdown = await markdownFiles(docsRoot);
const routeOwners = new Map();
for (const file of markdown) {
  const relative = path.relative(docsRoot, file).replaceAll("\\", "/");
  const route = relative === "index.md" ? "/" : `/${relative.replace(/\.md$/, "")}`;
  if (routeOwners.has(route)) errors.push(`duplicate route ${route}`);
  routeOwners.set(route, relative);

  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    if (!match[1].trim()) errors.push(`${relative}: image is missing alt text`);
    const target = match[2].split("#")[0].split("?")[0];
    if (/^(https?:|data:)/.test(target)) continue;
    if (!(await exists(path.resolve(path.dirname(file), target)))) {
      errors.push(`${relative}: missing image ${target}`);
    }
  }

  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0].split("?")[0];
    if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), target);
    const candidates = path.extname(resolved)
      ? [resolved]
      : [resolved, `${resolved}.md`, path.join(resolved, "index.md")];
    if (!(await Promise.any(candidates.map(async (candidate) => {
      if (await exists(candidate)) return true;
      throw new Error();
    })).catch(() => false))) {
      errors.push(`${relative}: broken link ${target}`);
    }
  }

  for (const match of content.matchAll(/(?:src|poster)="(\/demos\/[^"#?]+)"/g)) {
    const asset = path.join(docsRoot, "public", match[1]);
    if (!(await exists(asset))) errors.push(`${relative}: missing media ${match[1]}`);
  }
}

if (manifest.length !== 21) {
  errors.push(`menu-docs.json contains ${manifest.length} entries; expected 21`);
}

if (errors.length) {
  console.error(`Documentation check failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed: ${manifest.length} menu pages and ${markdown.length} Markdown files.`);
}
