---
title: Getting started
description: Install MCP Ops Studio and publish a reusable Function through MCP and HTTP.
---

# Getting started

MCP Ops Studio turns TypeScript Functions into authenticated MCP tools and HTTP
routes. A Project groups the Functions, endpoint configuration, Secrets, and
immutable deployments that belong together.

## 1. Install the application

Follow the [Docker Compose installation](./installation.md), open the setup URL,
and create the installation owner and first Project. Setup creates Development
and Production environments for the Project.

For repository development, follow [local development](./development.md).

## 2. Learn the control plane

The sidebar keeps Project work together: Functions, endpoints, Libraries,
Authentication, Secrets, Executions, Deployments, and Project settings. Owners
and admins also receive the cross-project overview. See [navigation and
roles](./app/navigation.md).

## 3. Build and test a Function

Open **Functions**, create a Function, define its JSON input schema, and save the
source. Validation checks the handler, schemas, imports, policies, and Function
call graph. Testing invokes the saved development version through the configured
executor and shows structured output, logs, duration, and safe errors.

Continue with [Build your first Function](./guides/first-function.md).

## 4. Publish the Function

Bind the Function to an [MCP Endpoint](./app/mcp-endpoints.md), an [HTTP
API](./app/http-apis.md), or both. Bindings name and type the external surface;
the Function remains the shared executable implementation.

## 5. Deploy and observe

Deploy all Project changes to Development, invoke the endpoint, and inspect the
result under [Executions](./app/executions.md). Release the completed immutable
snapshot to Production when it is ready.

## Next steps

- [Secure an endpoint](./guides/secure-endpoint.md)
- [Publish an MCP tool](./guides/mcp-tool.md)
- [Publish an HTTP route](./guides/http-route.md)
- [Release and roll back](./guides/release-and-rollback.md)
