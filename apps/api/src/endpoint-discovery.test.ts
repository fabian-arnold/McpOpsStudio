import { describe, expect, it } from "vitest";
import { parseManifest } from "@mcpops/shared";
import {
  availableEndpointDocumentFormats,
  generateEndpointDocument,
  type EndpointDiscoverySource,
} from "./endpoint-discovery.js";

const httpSource: EndpointDiscoverySource = {
  manifest: parseManifest(
    JSON.stringify({
      endpoint: { kind: "http", name: "Customers", slug: "customers" },
      functions: [{ name: "getCustomer", riskLevel: "read" }],
      http: {
        routes: [
          {
            method: "GET",
            path: "/customers/:customerId",
            function: "getCustomer",
            inputMapping: { customerId: "path.customerId", expand: "query.expand" },
          },
        ],
      },
    }),
    "json",
  ),
  environments: [
    {
      name: "Production",
      slug: "production",
      mcpUrl: "https://ops.example/mcp/acme/customers",
      httpBaseUrl: "https://ops.example/http/acme/customers",
    },
  ],
  functions: [
    {
      name: "getCustomer",
      inputSchema: {
        type: "object",
        required: ["customerId"],
        properties: {
          customerId: { type: "string" },
          expand: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
      },
    },
  ],
  auth: { type: "api_key", config: { header: "x-api-key" } },
};

describe("endpoint discovery documents", () => {
  it("generates OpenAPI 3.1 paths, schemas, servers and safe auth placeholders", () => {
    const generated = generateEndpointDocument("openapi-json", httpSource);
    const document = JSON.parse(generated.content);
    expect(generated.filename).toBe("customers.openapi.json");
    expect(document).toMatchObject({
      openapi: "3.1.0",
      servers: [{ url: "https://ops.example/http/acme/customers" }],
      components: {
        securitySchemes: {
          endpointAuth: { type: "apiKey", in: "header", name: "x-api-key" },
        },
      },
    });
    expect(document.paths["/customers/{customerId}"].get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "customerId", in: "path", required: true }),
        expect.objectContaining({ name: "expand", in: "query" }),
      ]),
    );
    expect(generated.content).not.toContain("secret");
  });

  it("offers protocol-appropriate formats and builds MCP client configuration", () => {
    const source: EndpointDiscoverySource = {
      ...httpSource,
      manifest: parseManifest(
        JSON.stringify({
          endpoint: { kind: "mcp", name: "Customer tools", slug: "tools" },
          functions: [{ name: "search", riskLevel: "read" }],
          mcp: { tools: [{ toolName: "search", function: "search" }] },
        }),
        "json",
      ),
    };
    expect(availableEndpointDocumentFormats("mcp")).toEqual([
      "mcp-client",
      "manifest-json",
      "manifest-yaml",
    ]);
    const generated = generateEndpointDocument("mcp-client", source);
    expect(JSON.parse(generated.content)).toMatchObject({
      mcpServers: {
        "tools-production": {
          type: "streamable-http",
          url: "https://ops.example/mcp/acme/customers",
          headers: { "x-api-key": "{{api_key}}" },
        },
      },
    });
    expect(() => generateEndpointDocument("openapi-json", source)).toThrow(
      /not available/,
    );
  });
});
