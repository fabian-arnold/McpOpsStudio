import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const siteRoot = path.join(repositoryRoot, "docs", "site");
const htmlPath = path.join(siteRoot, "index.html");
const html = await readFile(htmlPath, "utf8");
const errors = [];

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
for (const id of new Set(duplicateIds)) {
  errors.push(`Duplicate id: ${id}`);
}

const fragmentLinks = [...html.matchAll(/\bhref="#([^"]+)"/g)].map(
  (match) => match[1],
);
for (const fragment of new Set(fragmentLinks)) {
  if (!ids.includes(fragment))
    errors.push(`Missing fragment target: #${fragment}`);
}

const localAssets = [
  ...html.matchAll(/\b(?:href|src)="\.\/([^"?#]+)(?:[?#][^"]*)?"/g),
].map((match) => match[1]);
for (const asset of new Set(localAssets)) {
  try {
    await access(path.join(siteRoot, asset));
  } catch {
    errors.push(`Missing local asset: ${asset}`);
  }
}

const rootRelativeUrls = [
  ...html.matchAll(/\b(?:href|src)="\/(?!\/)([^"]*)"/g),
].map((match) => match[0]);
for (const url of rootRelativeUrls) {
  errors.push(`Root-relative URL is not project-Pages safe: ${url}`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Documentation site valid: ${ids.length} ids, ${fragmentLinks.length} fragment links, ${localAssets.length} local assets.`,
  );
}
