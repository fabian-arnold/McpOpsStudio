import http from "node:http";

if (process.env.MCP_OPS_DEMO_MODE !== "true") {
  console.error(JSON.stringify({
    level: "fatal",
    message: "mock CRM is development-only; set MCP_OPS_DEMO_MODE=true explicitly",
  }));
  process.exit(1);
}

const customers = [
  { id: "cus_ada", name: "Ada Lovelace", email: "ada@acme.test" },
  { id: "cus_grace", name: "Grace Hopper", email: "grace@acme.test" },
  { id: "cus_katherine", name: "Katherine Johnson", email: "katherine@acme.test" },
];

http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://mock-crm");
  response.setHeader("content-type", "application/json");
  if (request.method === "GET" && url.pathname === "/health") return response.end(JSON.stringify({ status: "ok" }));
  if (request.method === "GET" && url.pathname === "/customers") {
    const query = (url.searchParams.get("q") ?? "").toLowerCase();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 10), 50);
    const items = customers.filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(query)).slice(0, limit);
    return response.end(JSON.stringify({ items }));
  }
  const match = url.pathname.match(/^\/customers\/([^/]+)$/);
  if (request.method === "GET" && match) {
    const customer = customers.find((item) => item.id === match[1]);
    response.statusCode = customer ? 200 : 404;
    return response.end(JSON.stringify(customer ?? { error: "not_found" }));
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not_found" }));
}).listen(8090, "0.0.0.0");
