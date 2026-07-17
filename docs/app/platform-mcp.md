---
title: IDE access through platform MCP
---

# IDE access through platform MCP

MCP Ops Studio exposes an OAuth-protected Streamable HTTP control-plane server at
`/platform/mcp`. Add the absolute URL shown on the **IDE access** page to a compatible
coding client. The client opens the browser for local platform sign-in and consent;
runtime endpoint API keys are not used for control-plane access.

Access tokens expire after 15 minutes. Compatible clients renew them with a
rotating refresh token, so browser sign-in is not required again for 90 days
unless the authorization is revoked. Active MCP sessions use an eight-hour idle
timeout; each valid request renews that idle window.

Each MCP session starts without a Project. Call `projects_list` and then
`project_select` before using project-scoped tools. Project selection is isolated to
that MCP session and does not change the browser UI selection.

Function and library edits support unified patches or full source replacement.
Durable tools default to `dryRun: true`; repeat a successful preview with
`dryRun: false` and the returned version, checksum, or deployment plan checksum to
apply it. Public runtime traffic remains pinned to immutable snapshots until a
development Project deployment completes.

Cron bindings are available through `cron_bindings_list`, `cron_binding_get`,
`cron_binding_create`, `cron_binding_edit`, `cron_binding_delete`,
`cron_binding_run`, and `cron_binding_runs`. Create, edit, and delete operations
change draft configuration and require a Project deployment before scheduler state
changes. Manual runs use only the active immutable schedule artifact. The
`function_test` tool accepts `source: "cron"` with `cronBindingId` to simulate the
binding's empty input, service identity, permissions, network policy, and trigger
metadata against saved development Function code.

Typed storage is available through `storage_collections_list`,
`storage_collection_get`, collection create/version/grant tools, bounded
`storage_records_query` and optimistic record mutation tools. Cache inspection uses
`storage_cache_list`, `storage_cache_reveal`, and `storage_cache_delete`. Record and
cache values require owner or admin access; cache reveals are size-limited, redacted,
and audited. Storage mutations require `mcpops:write` and default to `dryRun: true`.

Endpoint discovery returns final environment URLs and describes the credential
scheme or header that callers must supply. It never includes credential or Secret
values.
