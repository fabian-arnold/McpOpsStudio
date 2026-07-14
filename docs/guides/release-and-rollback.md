---
title: Release and roll back
description: Promote an immutable Project snapshot and restore an earlier version.
---

# Release and roll back

<img src="/demos/release-and-rollback.gif" alt="Demo of deployment, execution verification, and audit history">

## Deploy to Development

1. Save all intended Function, Library, binding, and policy changes.
2. Select **Undeployed changes** in the header or open **Deployments**.
3. Queue the Development deployment.
4. Follow the Project build until every endpoint artifact completes.
5. Invoke the Development MCP and HTTP URLs and inspect Executions.

## Release to Production

On **Deployments**, choose the completed active Development version and release
it. Production receives the same pinned Function graph and compiled artifacts,
resolved with Production environment configuration.

## Roll back

Choose an earlier completed deployment, review its version and pinned Functions,
then confirm rollback. Verify the restored endpoint behavior and find the
rollback event in the Audit log.

## Related guides

- [Deployments](../app/deployments.md)
- [Runtime and deployments](../runtime-and-deployments.md)
