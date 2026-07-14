import assert from "node:assert/strict";

const baseUrl = process.env.INSTALL_SMOKE_URL ?? "http://127.0.0.1:8080";
const setupCode = process.env.MCP_OPS_SETUP_CODE;
if (!setupCode) throw new Error("MCP_OPS_SETUP_CODE is required");

async function json(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  if (!response.ok)
    throw new Error(`${response.status} ${path}: ${JSON.stringify(body)}`);
  return { response, body };
}

const setup = await json("/api/setup", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    setupCode,
    ownerEmail: "owner@example.com",
    ownerPassword: "InstallSmoke123!",
    projectName: "Note App",
    projectSlug: "note-app",
    publicUrl: "https://studio.example.com",
    starter: "notes-demo",
  }),
});
assert.equal(setup.body.starter, "notes-demo");
assert.ok(setup.body.deployment?.id);

const cookies =
  setup.response.headers.getSetCookie?.() ??
  [setup.response.headers.get("set-cookie")].filter(Boolean);
const cookie = cookies.map((value) => value.split(";", 1)[0]).join("; ");

for (let attempt = 0; attempt < 90; attempt += 1) {
  const deployments = await json("/api/deployments", {
    headers: { cookie },
  });
  const deployment = deployments.body.items.find(
    (item) => item.id === setup.body.deployment.id,
  );
  if (deployment?.status === "active") break;
  if (deployment?.status === "failed")
    throw new Error(`Starter deployment failed: ${JSON.stringify(deployment)}`);
  if (attempt === 89) throw new Error("Starter deployment did not become active");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

const authorization = `Basic ${Buffer.from("DEMO:DEMO").toString("base64")}`;
const notePath = "/http-dev/note-app/note-app/v1/notes/first";
const saved = await json(notePath, {
  method: "PUT",
  headers: {
    authorization,
    "content-type": "application/json",
  },
  body: JSON.stringify({ title: "Installed", body: "It works" }),
});
assert.equal(saved.body.id, "first");
assert.equal(saved.body.title, "Installed");

const loaded = await json(notePath, { headers: { authorization } });
assert.equal(loaded.body.found, true);
assert.equal(loaded.body.note.body, "It works");
console.log("Browser setup and Note App starter smoke test passed.");
