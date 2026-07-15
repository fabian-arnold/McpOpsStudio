---
title: Schedules
description: Invoke immutable Function snapshots with environment-scoped cron bindings.
---

# Schedules

Schedules bind a five-field cron expression to one Function in one Project
environment. They are bindings, not endpoints or workflows. Every invocation
receives `{}`; timing is available after narrowing `ctx.trigger.type === "cron"`.

```ts
export default async function handler(ctx: RuntimeContext, input: FunctionInput) {
  if (ctx.trigger.type !== "cron") return { ok: false };
  ctx.logger.info("Scheduled run", {
    scheduledAt: ctx.trigger.scheduledAt,
    origin: ctx.trigger.origin,
  });
  return { ok: true };
}
```

Editing changes only the draft. Development deployment captures Development and
Production schedule configuration in an immutable Project snapshot. Production
release promotes the captured Production slice, and rollback restores the whole
earlier schedule artifact.

Schedules have minute-level precision and use an IANA timezone. Daylight-saving
transitions follow the timezone database: nonexistent local times are skipped,
while repeated local times may produce separate ticks. Workers do not replay
downtime. A tick more than 60 seconds late is recorded as missed.

Each binding permits one active run. Overlaps are recorded as skipped. Queue
redelivery is durably deduplicated, but Function authors must still make
external side effects idempotent.

The binding owns a service subject, explicit permission grants, and an outbound
network policy. Grants must cover the Function's required permissions. Secrets
remain environment-resolved and never enter schedule artifacts. Network calls
retain the endpoint pipeline's DNS, private-address, allowlist, redirect,
timeout, TLS, and response-size protections.

**Run now** uses the active immutable artifact and overlap guard. Its trigger
origin is `manual`; the initiating user is audited separately from the service
caller used by the Function.
