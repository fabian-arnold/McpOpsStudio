---
title: IDE access through platform MCP
---

# IDE access through platform MCP

MCP Ops Studio exposes an OAuth-protected Streamable HTTP control-plane server at
`/platform/mcp`. Add the absolute URL shown on the **IDE access** page to a compatible
coding client. The client opens the browser for local platform sign-in and consent;
runtime endpoint API keys are not used for control-plane access.

Each MCP session starts without a Project. Call `projects_list` and then
`project_select` before using project-scoped tools. Project selection is isolated to
that MCP session and does not change the browser UI selection.

Function and library edits support unified patches or full source replacement.
Durable tools default to `dryRun: true`; repeat a successful preview with
`dryRun: false` and the returned version, checksum, or deployment plan checksum to
apply it. Public runtime traffic remains pinned to immutable snapshots until a
development Project deployment completes.

Endpoint discovery returns final environment URLs and describes the credential
scheme or header that callers must supply. It never includes credential or Secret
values.
