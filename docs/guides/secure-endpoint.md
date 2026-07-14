---
title: Secure an endpoint
description: Create credentials, grant permissions, and assign endpoint authentication.
---

# Secure an endpoint

<img src="/demos/secure-endpoint.gif" alt="Demo of Secret, authentication policy, and endpoint configuration">

## Store the credential

Open **Secrets**, create an uppercase credential name, and enter separate
Development and Production values. The application stores both values encrypted
and reports their presence.

## Create the policy

1. Open **Authentication** and create a policy.
2. Select the authentication type.
3. Reference the credential Secret name.
4. Add the exact Function permissions callers receive.
5. Save the policy.

## Assign it

Open the MCP Endpoint or HTTP API, select **Authentication**, assign the policy,
and place it in the desired evaluation order. Deploy the Project and invoke the
endpoint with the matching Development credential.

Review successful and denied attempts under **Executions** and correlate
configuration changes in the **Audit log**.

## Related guides

- [Authentication](../app/authentication.md)
- [Secrets](../app/secrets.md)
- [Security model](../security.md)
