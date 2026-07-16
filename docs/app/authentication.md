---
title: Authentication
description: Create reusable endpoint authentication and permission policies.
---

# Authentication

Authentication policies define how callers prove identity and which Function
permissions a successful policy grants. Policies are reusable across MCP
Endpoints and HTTP APIs in the selected Project.

![Authentication policy list and policy editor](../screenshots/app/authentication.png)

## Policy types

MCP Ops Studio supports public access, API keys, static bearer tokens, HTTP
Basic, JWT with remote JWKS, Microsoft Entra access tokens, and HMAC-SHA256
webhook signatures. A custom Function policy can implement a project-specific
credential exchange or identity lookup.

## Custom Function authentication

Select an enabled project Function when creating a custom Function policy. Its
current version and every literal `ctx.functions.call()` dependency are pinned
into the endpoint's immutable deployment snapshot.

The Function receives JSON request metadata:

```ts
export default async function handler(ctx, input) {
  const credential = input.request.headers["x-custom-token"];
  if (credential !== (await ctx.secrets.get("CUSTOM_AUTH_TOKEN")))
    return { authenticated: false, permissions: [] };

  return {
    authenticated: true,
    subject: "service:orders",
    tenantId: "tenant-1",
    permissions: ["orders.read"],
  };
}
```

`input.request` contains `method`, `path`, `headers`, `query`, and the
parsed JSON `body` when present. An authenticated result requires `subject`;
`tenantId`, `name`, `email`, and `permissions` are optional. The runtime
does not accept arbitrary caller claims from custom authentication output.

The Function runs through the normal isolated executor with its declared
Secrets, network policy, timeout, schemas, and internal Function graph. Because
its input can contain credentials, auth invocation payloads and Function logs
are not persisted.

## Create a policy

1. Select **New authentication policy**.
2. Choose the authentication type.
3. Configure type-specific fields such as header name, issuer, audience, JWKS
   URL, signature header, or username.
4. Reference credential values by Project Secret name.
5. Add the Function permissions granted by this policy.
6. Assign and order the policy on each endpoint that uses it.

The runtime evaluates endpoint authentication first, endpoint access second,
and Function permission authorization third. Every outcome receives a request ID
and persisted execution record.

## Related guides

- [Secrets](./secrets.md)
- [Secure an endpoint](../guides/secure-endpoint.md)
- [Audit log](./audit-log.md)
