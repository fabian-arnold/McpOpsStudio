import YAML from "yaml";
import { serializeManifest, type EndpointManifest } from "@mcpops/shared";

export const endpointDocumentFormats = [
  "openapi-json",
  "openapi-yaml",
  "postman",
  "mcp-client",
  "manifest-json",
  "manifest-yaml",
] as const;

export type EndpointDocumentFormat = (typeof endpointDocumentFormats)[number];

export type EndpointDiscoverySource = {
  manifest: EndpointManifest;
  environments: Array<{
    name: string;
    slug: string;
    mcpUrl: string;
    httpBaseUrl: string;
  }>;
  functions: Array<{
    name: string;
    inputSchema: unknown;
    outputSchema?: unknown;
  }>;
  auth?: { type: string; config?: unknown } | null;
};

export type EndpointDocument = {
  format: EndpointDocumentFormat;
  filename: string;
  mediaType: string;
  content: string;
};

export function availableEndpointDocumentFormats(
  kind: "mcp" | "http",
): EndpointDocumentFormat[] {
  return kind === "http"
    ? ([
        "openapi-json",
        "openapi-yaml",
        "postman",
        "manifest-json",
        "manifest-yaml",
      ] satisfies EndpointDocumentFormat[])
    : ([
        "mcp-client",
        "manifest-json",
        "manifest-yaml",
      ] satisfies EndpointDocumentFormat[]);
}

export function generateEndpointDocument(
  format: EndpointDocumentFormat,
  source: EndpointDiscoverySource,
): EndpointDocument {
  const allowed = availableEndpointDocumentFormats(source.manifest.endpoint.kind);
  if (!allowed.includes(format))
    throw new Error(
      `${format} is not available for ${source.manifest.endpoint.kind} endpoints`,
    );

  const slug = source.manifest.endpoint.slug;
  if (format === "manifest-json")
    return {
      format,
      filename: `${slug}.manifest.json`,
      mediaType: "application/json",
      content: serializeManifest(source.manifest, "json"),
    };
  if (format === "manifest-yaml")
    return {
      format,
      filename: `${slug}.manifest.yaml`,
      mediaType: "application/yaml",
      content: serializeManifest(source.manifest, "yaml"),
    };
  if (format === "mcp-client")
    return {
      format,
      filename: `${slug}.mcp.json`,
      mediaType: "application/json",
      content: JSON.stringify(mcpClientConfiguration(source), null, 2),
    };

  const openapi = openApiDocument(source);
  if (format === "openapi-json")
    return {
      format,
      filename: `${slug}.openapi.json`,
      mediaType: "application/vnd.oai.openapi+json;version=3.1",
      content: JSON.stringify(openapi, null, 2),
    };
  if (format === "openapi-yaml")
    return {
      format,
      filename: `${slug}.openapi.yaml`,
      mediaType: "application/vnd.oai.openapi;version=3.1",
      content: YAML.stringify(openapi),
    };
  return {
    format,
    filename: `${slug}.postman_collection.json`,
    mediaType: "application/json",
    content: JSON.stringify(postmanCollection(source), null, 2),
  };
}

function openApiDocument(source: EndpointDiscoverySource) {
  const functions = new Map(source.functions.map((fn) => [fn.name, fn]));
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of source.manifest.http?.routes ?? []) {
    if (!route.enabled) continue;
    const path = openApiPath(route.path);
    const fn = functions.get(route.function);
    const operation = openApiOperation(route, fn);
    paths[path] = {
      ...(paths[path] ?? {}),
      [route.method.toLowerCase()]: operation,
    };
  }
  const security = securityDescription(source.auth);
  return {
    openapi: "3.1.0",
    info: {
      title: source.manifest.endpoint.name,
      version: source.manifest.endpoint.runtimeVersion,
      ...(source.manifest.endpoint.description
        ? { description: source.manifest.endpoint.description }
        : {}),
    },
    servers: source.environments.map((environment) => ({
      url: environment.httpBaseUrl,
      description: environment.name,
      "x-mcpops-environment": environment.slug,
    })),
    paths,
    ...(security ? security : {}),
    "x-mcpops-endpoint": {
      slug: source.manifest.endpoint.slug,
      authPolicy: source.manifest.auth?.policy,
    },
  };
}

function openApiOperation(
  route: NonNullable<EndpointManifest["http"]>["routes"][number],
  fn: EndpointDiscoverySource["functions"][number] | undefined,
) {
  const inputSchema = schema(fn?.inputSchema);
  const outputSchema = schema(fn?.outputSchema);
  const pathNames = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map(
    (match) => match[1]!,
  );
  const properties = record(inputSchema.properties);
  const required = new Set(
    Array.isArray(inputSchema.required)
      ? inputSchema.required.filter((item): item is string => typeof item === "string")
      : [],
  );
  const mapping = record(route.inputMapping);
  const parameters: Array<Record<string, unknown>> = [];
  const bodyProperties: Record<string, unknown> = {};

  for (const [name, propertySchema] of Object.entries(properties)) {
    const mappedSource = typeof mapping[name] === "string" ? mapping[name] : "";
    const pathName = pathNames.includes(name)
      ? name
      : mappedSource.startsWith("path.")
        ? mappedSource.slice(5)
        : undefined;
    const queryName = mappedSource.startsWith("query.")
      ? mappedSource.slice(6)
      : route.method === "GET" && !pathName
        ? name
        : undefined;
    const headerName = mappedSource.startsWith("headers.")
      ? mappedSource.slice(8)
      : undefined;
    if (pathName || queryName || headerName) {
      parameters.push({
        name: pathName ?? queryName ?? headerName,
        in: pathName ? "path" : headerName ? "header" : "query",
        required: Boolean(pathName) || required.has(name),
        schema: propertySchema,
      });
    } else {
      bodyProperties[name] = propertySchema;
    }
  }

  for (const pathName of pathNames)
    if (
      !parameters.some(
        (parameter) => parameter.in === "path" && parameter.name === pathName,
      )
    )
      parameters.push({
        name: pathName,
        in: "path",
        required: true,
        schema: { type: "string" },
      });

  const bodyRequired = [...required].filter((name) => name in bodyProperties);
  const requestBody = Object.keys(bodyProperties).length
    ? {
        required: bodyRequired.length > 0,
        content: {
          "application/json": {
            schema: {
              ...inputSchema,
              type: "object",
              properties: bodyProperties,
              ...(bodyRequired.length ? { required: bodyRequired } : {}),
            },
          },
        },
      }
    : undefined;

  return {
    operationId: `${route.function}_${route.method}`.replace(/[^A-Za-z0-9_]/g, "_"),
    summary: `${route.method} ${route.path}`,
    description: `Invokes the ${route.function} project Function.`,
    ...(parameters.length ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses: {
      "200": {
        description: "Successful function result",
        content: { "application/json": { schema: outputSchema } },
      },
      "400": { description: "Input validation failed" },
      "401": { description: "Authentication failed" },
      "403": { description: "Permission denied" },
      "500": { description: "Safe runtime error" },
    },
    ...(Object.keys(mapping).length ? { "x-mcpops-input-mapping": mapping } : {}),
    "x-mcpops-function": route.function,
  };
}

function securityDescription(auth: EndpointDiscoverySource["auth"]) {
  if (!auth) return undefined;
  const config = record(auth.config);
  const type = auth.type;
  const scheme =
    type === "api_key" || type === "webhook_hmac"
      ? {
          type: "apiKey",
          in: "header",
          name:
            typeof config.header === "string"
              ? config.header
              : type === "api_key"
                ? "x-api-key"
                : "x-signature",
        }
      : type === "basic"
        ? { type: "http", scheme: "basic" }
        : { type: "http", scheme: "bearer" };
  return {
    security: [{ endpointAuth: [] }],
    components: { securitySchemes: { endpointAuth: scheme } },
  };
}

function postmanCollection(source: EndpointDiscoverySource) {
  const baseUrl = source.environments[0]?.httpBaseUrl ?? "{{baseUrl}}";
  const authHeaders = exampleAuthHeaders(source.auth);
  return {
    info: {
      name: source.manifest.endpoint.name,
      description: source.manifest.endpoint.description,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [{ key: "baseUrl", value: baseUrl }],
    item: (source.manifest.http?.routes ?? [])
      .filter((route) => route.enabled)
      .map((route) => ({
        name: `${route.method} ${route.path}`,
        request: {
          method: route.method,
          header: [
            ...authHeaders,
            ...(["POST", "PUT", "PATCH"].includes(route.method)
              ? [{ key: "content-type", value: "application/json" }]
              : []),
          ],
          url: {
            raw: `{{baseUrl}}${route.path.replace(/:([A-Za-z0-9_]+)/g, "{{$1}}")}`,
            host: ["{{baseUrl}}"],
            path: route.path.split("/").filter(Boolean),
          },
          ...(["POST", "PUT", "PATCH"].includes(route.method)
            ? { body: { mode: "raw", raw: "{}" } }
            : {}),
          description: `Invokes the ${route.function} project Function.`,
        },
      })),
  };
}

function mcpClientConfiguration(source: EndpointDiscoverySource) {
  const headers = Object.fromEntries(
    exampleAuthHeaders(source.auth).map((header) => [header.key, header.value]),
  );
  return {
    mcpServers: Object.fromEntries(
      source.environments.map((environment) => [
        `${source.manifest.endpoint.slug}-${environment.slug}`,
        {
          type: "streamable-http",
          url: environment.mcpUrl,
          ...(Object.keys(headers).length ? { headers } : {}),
        },
      ]),
    ),
  };
}

function exampleAuthHeaders(auth: EndpointDiscoverySource["auth"]) {
  if (!auth) return [];
  const config = record(auth.config);
  if (auth.type === "api_key")
    return [
      {
        key: typeof config.header === "string" ? config.header : "x-api-key",
        value: "{{api_key}}",
      },
    ];
  if (auth.type === "basic")
    return [{ key: "Authorization", value: "Basic {{basic_credentials}}" }];
  if (auth.type === "webhook_hmac")
    return [
      {
        key: typeof config.header === "string" ? config.header : "x-signature",
        value: "{{webhook_signature}}",
      },
    ];
  return [{ key: "Authorization", value: "Bearer {{access_token}}" }];
}

function openApiPath(path: string) {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function schema(value: unknown): Record<string, unknown> {
  const candidate = record(value);
  return Object.keys(candidate).length ? candidate : {};
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
