---
title: Publish an MCP tool
description: Bind a Function, deploy it, and invoke it with an MCP client.
---

# Publish an MCP tool

<img src="/demos/mcp-tool.gif" alt="Demo of an MCP Endpoint binding and its execution history">

## Bind the Function

1. Open **MCP Endpoints** and select the target endpoint.
2. On **Bindings**, choose **Add tool**.
3. Select the Function, enter a stable tool name and description, and enable it.
4. Check **Authentication** for the caller policy and granted permissions.
5. Deploy the Project to Development.

## Initialize and call

Use the Development URL shown on the endpoint overview and its configured
credential. Initialize the stateless session, list tools, and call the tool:

```bash
curl -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-api-key: $MCP_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"docs","version":"1"}}}'
```

Call `tools/list`, then send `tools/call` with the binding name and schema-valid
arguments. Open **Executions** and locate the call by request ID.

## Related guides

- [MCP Endpoints](../app/mcp-endpoints.md)
- [Secure an endpoint](./secure-endpoint.md)
