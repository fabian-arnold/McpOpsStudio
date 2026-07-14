---
title: Function editor
description: Author, validate, test, and expose a TypeScript Function.
---

# Function editor

The Function editor combines Monaco TypeScript editing with the operational
contract needed to deploy the Function safely.

![Function editor with source, schemas, and test output](../screenshots/app/function-editor.png)

## Source and imports

Write the default async handler and use the typed `ctx` capabilities for
logging, HTTP, Secrets, storage, cache, audits, reviewed queries, and internal
Function calls. Autocomplete includes reviewed `@mcpops/shared/*` modules and
versioned `@mcpops/lib/*` project Libraries.

## Schemas

The input schema validates every invocation. An output schema, when configured,
validates the returned value. Schema helpers insert common JSON Schema shapes
and keep the editor focused on the public Function contract.

## Policy

Configure risk level, required permissions, Secret grants, timeout, and enabled
state. Endpoint authentication grants the permissions that a caller receives;
the invocation pipeline compares those grants with the Function requirements.

## Save, validate, and test

1. **Save** creates a development Function version.
2. **Validate** checks TypeScript, schemas, imports, policies, and Function calls.
3. **Test** invokes the saved version using the selected development endpoint
   context, caller, source, and JSON input.
4. Inspect output, logs, duration, and the safe error panel.

## Bindings

The exposure panel lists every MCP tool and HTTP route using the Function. Add
or edit a binding from the editor or open the endpoint detail page.

## Related guides

- [Libraries](./libraries.md)
- [Authentication](./authentication.md)
- [Secrets](./secrets.md)
- [Executions](./executions.md)
