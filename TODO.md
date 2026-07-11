# MCP Ops Studio TODO

This index records gaps found during the elementary-functionality review on
2026-07-10. The working MCP/HTTP deployment vertical slice is not repeated
here. Keep fixes narrow: prefer completing an existing path or removing an
inert affordance over introducing another subsystem.

Status: `[ ]` open, `[x]` complete. Priorities are P0 (correctness/security),
P1 (ordinary product operation), and P2 (polish/cleanup).

## Product scope decision

MCP Ops Studio targets one self-hosted installation, not a multitenant SaaS
control plane.

- **Projects are the operational data boundary.** A project owns environments,
  reusable Functions, MCP Endpoints, HTTP APIs, secrets, auth policies, libraries,
  and their runtime data. Typed endpoints select project Functions through
  bindings. Project deployments pin all endpoint artifacts into one immutable
  environment version.
- **Users and roles are installation-wide.** Do not add project membership,
  per-project ACLs, invitations, or groups.
- **Organization must be removed completely.** There is no hidden singleton,
  compatibility model, organization selector, organization API, or
  `organizationId` application column. Backward compatibility is explicitly
  not required: use a clean schema reset with no data backfill, dual writes,
  legacy aliases, or transition layer.
- **Composition is code-first.** Functions may call project Functions through
  `ctx.functions.call()`. MCP Endpoints and HTTP APIs use protocol bindings. The
  binding map visualizes and edits those associations only; it is not a workflow
  canvas and cannot compose executable logic.
- **Hosting has two application roles.** The public control plane packages the
  web UI, API and proxy. Identical private workers handle runtime invocations
  and deployment builds and may scale horizontally. PostgreSQL and Redis remain
  supporting infrastructure.

## P0 — correctness and local-auth safety

- [x] **TODO-033 — Preserve timestamps when redacting API responses.** The
      Executions and Audit log pages render every persisted record as
      **Invalid Date** because `redactSensitive()` treats `Date` instances as
      generic objects and converts them to `{}`. Preserve dates as dates/ISO
      strings at the redaction boundary, cover nested dates with a regression
      test, and verify list, detail, and CSV responses retain valid timestamps.
      (`packages/shared/src/security.ts`, `apps/api/src/server.ts`)

- [x] **TODO-001 — Prevent deployment of unexpectedly stale drafts.** Project
      Function editors now only save immutable draft versions; they do not offer
      a deploy action. Deployment is an explicit endpoint operation, and Function
      usage views identify runtime endpoints whose active snapshot is stale. Runtime still
      serves only the selected endpoint's immutable active snapshot.

- [x] **TODO-002 — Make local login identity installation-wide.** `User.email`
      is currently unique only within an organization, while login searches by
      email with `findFirst`. Remove `organizationId` from `User`, add a global
      unique email constraint, and use a deterministic lookup. Add an
      authentication test rejecting duplicate installation-wide email addresses.
      (`prisma/schema.prisma`, `apps/api/src/server.ts`)

- [x] **TODO-003 — Add a change-password flow for the signed-in local user.**
      Require the current password, validate the replacement, hash with Argon2,
      audit the change, and rotate or invalidate the current session. This is the
      minimum account-management feature needed to replace development seed
      credentials; do not add password reset email, SSO, invitations, or a user
      administration subsystem as part of this task.

- [x] **TODO-004 — Do not ship development credentials in the normal login
      form.** The page currently pre-fills `admin@acme.test` / `ChangeMe123!` and
      always renders the seed-account card. Gate that convenience on an explicit
      public demo flag or remove it from the UI and keep it in development docs.
      (`apps/web/app/login/page.tsx`)

- [x] **TODO-025 — Add the Project domain as a clean replacement.** Add a
      `Project` model (`id`, `name`, `slug`, `description`, `status`, timestamps).
      Do not convert or re-parent existing organization data. Replace the migration
      baseline and recreate development databases. The seed creates the Acme
      project directly with slug `acme`, plus fresh environments, endpoints, users,
      policies, secrets, deployments, and demo records.

- [x] **TODO-026 — Implement Project CRUD and project-first navigation.** Add
      installation-scoped Zod APIs and UI for listing, creating, opening, renaming,
      archiving, and deleting projects. A project detail page should list its
      endpoints and offer **New endpoint** with the project preselected.
      Replace the disabled organization selector with a working project chooser;
      keep existing endpoint detail URLs to avoid a route migration.

- [x] **TODO-027 — Define safe Project removal.** Archiving a project must
      immediately disable its endpoints while preserving deployments, executions,
      and immutable audit history. Permanent deletion is allowed only when the
      project has no endpoints; return a clear blocking error otherwise. Provide a
      typed confirmation and audit both archive and deletion. Do not implement a
      cascading hard delete of runtime history.

- [x] **TODO-028 — Add installation-wide local user administration.** Owners
      need one simple Users page and scoped APIs to list users, create a user with a
      temporary password, change role, remove access (disable), and restore access.
      Disabled users cannot create sessions and their existing sessions become
      invalid. Prevent disabling/removing the last owner and prevent accidental
      self-lockout. Preserve user records referenced by immutable audit events;
      “Remove user” means revoke access, not erase history. Do not add email invites,
      password-reset email, SSO, groups, or project memberships.

- [x] **TODO-029 — Require temporary-password replacement.** A user created by
      an owner must change the temporary password on first sign-in before accessing
      the control plane. Reuse the password-change endpoint from TODO-003 and keep
      this to one boolean/session gate; do not build an account onboarding system.

- [x] **TODO-030 — Remove Organization from the database schema.** Delete the
      `Organization` Prisma model and every live `organizationId` field, relation,
      index, and unique constraint. Replace ownership as follows: Projects own
      Environments, runtime endpoints, Secrets, Auth Policies, Organization Libraries
      (rename them Project Libraries), reviewed database connections/queries, and
      project audit/runtime records; Users are installation-wide. Functions and
      Project Libraries belong directly to Project; bindings inherit Project
      through their endpoint. Replace/squash the unreleased
      migration baseline so Organization is absent from migration SQL as well as
      the current Prisma schema and generated client.

- [x] **TODO-031 — Replace organization runtime context and resource scopes.**
      Replace `RuntimeContext.organization` with `RuntimeContext.project` and carry
      immutable project identity through deployments, executions, audit events,
      manifests, and executor requests. Change secret, storage, cache, reviewed DB,
      rate-limit, and logging scopes from
      `organization/environment/endpoint/function` to
      `project/environment/endpoint/function`. Add regression tests proving two
      projects cannot read each other's scoped resources even though users are
      installation-wide.

- [x] **TODO-032 — Replace organization routing and control-plane scoping.**
      Runtime URLs become `/mcp/{projectSlug}/{endpointSlug}` and
      `/http/{projectSlug}/{endpointSlug}`. Do not add aliases or redirects for the
      former organization interpretation of those path segments. Require endpoint
      slugs to be unique within a project so routing is not ambiguous across
      environments. Replace `orgContext`, organization repository helpers, session
      claims, API response fields, web types, UI labels, metrics, logs, and docs
      with project or installation scope as appropriate. Completion requires no
      source or migration reference to `Organization`, `organizationId`, or
      `organizationSlug`.

## P1 — elementary control-plane operations

- [x] **TODO-041 — Make Functions reusable project resources.** Move Function
      ownership from endpoint to Project, replace nested endpoint Function APIs
      and navigation with `/api/functions/*` and a Project Functions area, and
      retain endpoint-scoped MCP/HTTP bindings. Show which runtime endpoints use a Function
      and which deployed versions are stale. Reset and reseed the unreleased
      baseline rather than implementing compatibility behavior.

- [x] **TODO-042 — Add controlled code-based Function composition.** Add typed
      `ctx.functions.call("literal_slug", input)` autocomplete and runtime
      execution. Deployment must resolve and pin transitive Function versions,
      reject missing/dynamic targets and cycles, and runtime must validate child
      schemas, preserve child capability policies, enforce depth/timeout limits,
      and persist parent/root execution lineage.

- [x] **TODO-043 — Superseded by typed endpoint binding tables.** The combined
      MCP tool and HTTP route creation and deletion remain ordinary table
      operations on their corresponding endpoint type.

- [x] **TODO-045 — Split the generic runtime endpoint into MCP Endpoints and HTTP APIs.** Replace the
      generic endpoint resource with independently deployed typed runtime
      endpoints. MCP Endpoints own only tool bindings; HTTP APIs own only route
      bindings. Functions remain project-wide and may be reused by any number of
      endpoints. Authentication and network policy remain endpoint-specific;
      storage and cache are shared by project/environment/Function. Remove the
      exposure canvas, per-route authentication overrides, compatibility APIs,
      and the previous migration baseline. Seed both endpoint types with two
      rollback-capable snapshots.
- [x] **TODO-046 — Deploy and release at Project level.** Draft saves target
      development. One Project deployment builds every MCP Endpoint and HTTP
      API atomically; a failed endpoint artifact cannot partially activate the
      Project version. Production release promotes a completed immutable
      development snapshot without reading drafts or recompiling source.
      Development and Production have separate active pointers, environment
      values, secrets, host-based runtime selection, histories, and Project-wide
      rollback.
- [x] **TODO-047 — Test immutable saved development Function versions.** Saving
      creates a FunctionVersion that can be compiled by the control plane and
      executed only through the private runtime executor. A development endpoint
      supplies capabilities without supplying executable code. Tests support
      unbound Functions and pinned internal calls, persist exact Function-version
      provenance, and never change the active MCP/HTTP snapshot. The E2E suite
      proves saved-only code is testable but absent from public `tools/list`.
- [x] **TODO-048 — Restore the drag-and-drop endpoint map.** Endpoint Map has its
      own Project navigation entry. Users drag Function nodes onto MCP Endpoint
      or HTTP API nodes, configure the resulting tool/route, inspect multiple
      connections, and remove bindings. It edits only protocol exposure and does
      not introduce workflow composition.
- [x] **TODO-049 — Consolidate installation administration navigation.** Projects,
      installation-wide users, and immutable audit events are summarized in one
      Administration view. Their full management pages remain linked from that
      view; Templates and the former separate administrative links are removed
      from navigation.
- [x] **TODO-050 — Make endpoint authentication manageable.** MCP Endpoint and
      HTTP API Authentication tabs can create API-key, bearer-token, and Basic
      policies, create or reuse encrypted environment Secrets, grant Function
      permissions, and switch the endpoint's selected policy. An explicit public
      policy supports intentionally unauthenticated endpoints without treating a
      missing policy as public.
- [x] **TODO-044 — Package two horizontally scalable application roles.** Ship
      a public `control-plane` role containing Caddy, web and API, and an
      identical private `worker` role containing runtime and deployment job
      processing with separate concurrency limits. Authenticate internal proxy
      requests, preserve request IDs, keep worker ports private, add readiness,
      and support `docker compose ... up --scale worker=N`.

- [x] **TODO-036 — Provide working project-library and function editing.**
      Libraries now have a dedicated Monaco editor with immutable version history,
      restricted-module declarations, and TypeScript symbol completion. The
      function explorer contains only functions and project libraries, and its
      Monaco editor provides a typed RuntimeContext, a schema-derived FunctionInput,
      and project-library completion without implicit-any handler parameters.
      Browser save tests cover both library version creation and
      function draft updates; the latter also fixed strict update payloads and
      underscore function-slug validation.

- [x] **TODO-037 — Simplify runtime credential authentication.** Runtime
      authentication policies no longer configure roles or scopes. Static
      credentials may grant named function permissions, endpoint restrictions use
      caller subjects only, and HTTP Basic authentication uses a configured
      username plus an encrypted password Secret reference.

- [x] **TODO-038 — Use table views for authentication and secrets.** endpoint
      authentication policies and environment secrets now use responsive tables
      with provider/credential or grant metadata, status, and row actions while
      preserving write-only secret handling.

- [x] **TODO-040 — Delete MCP and HTTP bindings from the UI.** Both binding
      views expose confirmed delete actions backed by the scoped API endpoints.
      Deletion updates draft configuration, records an audit event, refreshes the
      table, and clearly leaves the active immutable deployment unchanged.

- [ ] **TODO-005 — Let an authorized operator re-enable a disabled endpoint.**
      The API already exposes `POST /api/runtime-endpoints/:endpointId/enable`, but both the
      endpoint list and settings only offer Disable. Add a confirmed Enable action
      and refresh the endpoint status after success.

- [ ] **TODO-006 — Keep asynchronous deployment state current.** After a
      deployment is queued, poll while any visible deployment is queued, building,
      or deploying; stop on a terminal state and refresh the active deployment.
      Use a modest interval and stop polling when the page is hidden/unmounted.

- [x] **TODO-007 — Only offer rollback for valid immutable targets.** The
      endpoint UI shows Rollback for every non-active deployment,
      including queued and failed builds that the API rejects. Show it only for a
      completed prior snapshot (currently `rolled_back`) and cover the eligibility
      rule with a component/helper test.

- [ ] **TODO-008 — Respect platform roles before presenting mutations.** The
      endpoint detail and function editor expose deploy, edit, secret, policy,
      binding, rollback, and disable controls to roles that the API will reject.
      Reuse `useCurrentUser` / `roleAllows` to hide or disable actions with a short
      reason; keep the API as the enforcement boundary.

- [ ] **TODO-009 — Complete existing auth-policy actions.** Binding deletion is
      complete. Add small confirmed UI actions for selecting the endpoint-default
      and deleting an unused auth policy. The installation-scoped API endpoints
      already exist; do not add a new management page.

- [ ] **TODO-010 — Use API cursor pagination in operations lists.** Executions
      load at most 500 records and discard `nextCursor`; deployments and audit
      events similarly show only the first API page. Implement Previous/Next with
      cursor history for all three pages. Exports must clearly export the current
      page/filter or use the existing server CSV response—never imply that a
      partial client page is a complete export.

- [ ] **TODO-011 — Finish the elementary execution filters.** Wire the API’s
      existing date range, endpoint, function, MCP tool, HTTP route, and caller
      subject filters into the execution page. Apply filters on submit (or
      debounce) instead of issuing a request for every keystroke. Keep the endpoint
      detail view simpler and scoped to that endpoint.

- [ ] **TODO-012 — Warn before discarding editor changes.** When the function
      editor is dirty, protect browser refresh/navigation and in-app navigation.
      A simple confirmation is sufficient; no draft autosave or collaborative
      editing is required.

- [x] **TODO-013 — Add real empty states to endpoint tabs.** The endpoint exposure
      editor, authentication policies, secrets, deployments, and
      active-deployment Functions must not render blank containers when empty.
      Reuse `EmptyState` and the existing create action where applicable.

- [x] **TODO-014 — Make snapshot and test wording match runtime behavior.**
      The Function editor now labels saved development code separately from
      deployed endpoint code. Testing executes the latest saved immutable
      FunctionVersion through a development capability endpoint, while public
      MCP/HTTP calls remain pinned to active Project deployment snapshots.

- [x] **TODO-015 — Remove development-isolation notices.** This was completed by
      Completed by removing warning banners and notice fields from the function
      editor, endpoint overview, platform page, runtime manifest, MCP initialize
      response, and executor metadata. Provider selection and executor safety
      behavior remain unchanged.

## P1 — remove unavailable, inert, or mock-only product surface

The goal of this pass is a smaller truthful product, not implementation of the
features named below.

- [ ] **TODO-016 — Remove the inert environment affordance.** The login’s
      non-functional password-reset action is gone and Projects now have a working
      selector. Render environment scope as plain context instead of a disabled
      selector with a “switching is not available” tooltip. The endpoint-list
      environment filter remains the working way to narrow endpoints.

- [ ] **TODO-017 — Limit the visible auth editor to providers available in the
      current build.** Remove disabled OIDC/Entra/JWT options and “provider deferred”
      cards/copy from the endpoint UI. For the default setup, show API key, HTTP
      Basic, and static bearer only. If feature-flagged runtime JWT/Entra support is retained, expose
      it only when `/api/capabilities` reports it enabled; this is runtime endpoint
      auth, not control-plane SSO.

- [ ] **TODO-018 — Hide feature-gated configuration instead of advertising an
      unavailable feature.** When reviewed database queries are disabled, omit the
      reviewed-query configuration panel and its unavailable card. Apply the same
      rule to installable templates whose provider capability is unavailable;
      configuration-required but supported templates may remain visible.

- [ ] **TODO-019 — Remove invalid endpoint actions and hard-coded auth
      examples.** Public MCP endpoints require authenticated POST requests, so an
      external-link icon that opens them with GET is misleading. Remove it. Replace
      hard-coded `x-api-key` curl fragments with a complete, valid example derived
      from the active API-key policy, or show only a copyable endpoint.

- [ ] **TODO-020 — Remove or operationalize mock-only “ready” templates.** The
      local search template returns synthetic data and the confirmed-write template
      returns `updated: true` without a state change. Do not offer these as ready
      operational units: either remove them from the install catalog or make them
      perform a small real scoped-storage operation. Keep examples requiring an
      external host disabled until configured.

- [ ] **TODO-021 — Rename read-only Platform settings.** The page reports
      capabilities but contains no settings. Rename it to **Platform status** (and
      its navigation entry), describe local login as installation-wide rather than
      project-scoped, then remove unavailable enterprise-auth/package rows. Do not
      build enterprise settings to justify the old title.

## P2 — dead surface and documentation cleanup

- [ ] **TODO-034 — Avoid redundant zero-value dashboard trends.** The Error
      rate card currently renders `0%` as the value and a second downward-arrow
      `0%` trend beside it. Hide a comparison when the change is exactly zero (or
      render a clearly neutral delta) so the card does not imply a decrease that
      did not happen. Apply the same rule consistently to the dashboard metrics.

- [ ] **TODO-035 — Clean up users created by the E2E test.** Repeated
      `scripts/e2e.mjs` runs leave disabled `e2e-user-*` accounts in the normal
      Users screen. Delete test-created users when their audit references permit
      it, or run the account lifecycle checks inside a disposable database/fixture
      boundary, so routine verification does not pollute the operator UI.

- [ ] **TODO-022 — Remove unused speculative API routes.** No web client uses
      `/api/search`, `/api/notifications`, `/api/account/security`, or
      `/api/auth-policy-providers`. Remove these routes and their now-unused
      contracts/tests unless a current caller is identified. Extend the real
      password endpoint from TODO-003 rather than preserving the read-only deferred
      account response.

- [ ] **TODO-023 — Remove the retired template install endpoint.** Delete the
      `410`-only `POST /api/templates/install` route and remove it from
      `docs/api.md`; the endpoint-scoped preview/install endpoints are the supported
      path. While editing the API reference, add the already-implemented Enable,
      binding Delete, auth-policy Patch/Default/Delete, and cursor/filter query
      behavior.

- [ ] **TODO-024 — Consolidate future/deferred documentation.** Keep one short,
      authoritative **Supported and out of scope** section (local control-plane
      auth, single installation with Projects, no organization/multitenant support,
      no Microsoft Graph connections/enterprise SSO, no Kubernetes provider)
      instead of repeating unavailable-feature notes throughout the README and
      docs. Remove stale wording such as the PostgreSQL template’s “future queryId”
      description because reviewed queries are already implemented behind a flag.
      Retain necessary security limitations and the trusted-executor warning; those
      are operational safeguards, not marketing for future features.

## Recommended low-complexity sequence

1. Project replacement, local account administration, and TODO-002 through
   TODO-004 plus TODO-025 through TODO-032 are complete.
2. Reusable Functions, code composition, endpoint exposure, and two-role hosting
   in TODO-041 through TODO-044 are complete.
3. Complete stale-deploy and endpoint lifecycle work in TODO-001 and TODO-005
   through TODO-007.
4. Finish existing API-backed controls and pagination in TODO-008 through
   TODO-015.
5. Remove deferred UI, mock-only surfaces, and dead routes in TODO-016 through
   TODO-024.
6. Run focused API/UI tests, the full typecheck/build, and the seeded E2E flow;
   manually verify both owner and viewer sessions before marking this review
   complete.

## Browser review

A Chrome pass was completed on 2026-07-11 against the two-role Compose stack
with two private worker replicas. Separate MCP Endpoint and HTTP API lists and
details rendered correctly, their protocol-specific binding tables exposed the
seeded reusable Functions, and no browser console warnings or errors appeared.
The live E2E test also bound one project Function to two MCP Endpoints and invoked
its pinned internal Function call.

A second Chrome pass on 2026-07-11 verified the final MCP Endpoints terminology,
the Development and Production Project-deployment lanes, Project release and
rollback controls, removal of endpoint-level deployment controls, removal of
development-isolation notices, and the tenant-free Executions table. No browser
console warnings or errors appeared.

An earlier Chrome pass was completed on 2026-07-10 against the running Compose stack.
The dashboard, endpoint list and overview, Monaco function editor,
Projects, Users, Executions, Deployments, Templates, Audit log, documentation,
platform status, and the mobile navigation breakpoint loaded without browser
console warnings or errors. That pass found TODO-033 through TODO-035. Keyboard
and screen-reader behavior still need a dedicated accessibility pass.
