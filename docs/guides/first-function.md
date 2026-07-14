---
title: Build your first Function
description: Create, validate, and test a reusable TypeScript Function.
---

# Build your first Function

This walkthrough creates a small Function with a typed input and tests its saved
development version.

<img src="/demos/first-function.gif" alt="Demo moving from Function authoring to a persisted execution">

## Create the Function

1. Select **Functions** and **New Function**.
2. Set the name to `Customer greeting` and slug to `customer-greeting`.
3. Use this input schema:

```json
{
  "type": "object",
  "properties": { "name": { "type": "string", "minLength": 1 } },
  "required": ["name"],
  "additionalProperties": false
}
```

4. Enter the handler:

```ts
export default async function handler(ctx, input) {
  ctx.logger.info("Creating greeting", { requestId: ctx.invocation.requestId });
  return { greeting: `Hello, ${input.name}!` };
}
```

5. Save, then validate the Function.

## Test the saved version

Open the test panel, choose a Development endpoint context, and enter:

```json
{ "name": "Ada" }
```

Run the test and confirm the output contains `Hello, Ada!`. Review the log entry,
duration, request ID, and execution record.

## Continue

- [Publish it as an MCP tool](./mcp-tool.md)
- [Publish it as an HTTP route](./http-route.md)
