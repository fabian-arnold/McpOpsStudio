# Storage

The Storage page manages two distinct capabilities:

- **Collections** are durable, typed PostgreSQL data shared by explicitly granted Functions.
- **Cache** is non-authoritative Redis data with bounded operational inspection.

The existing `ctx.storage` key/value API remains available for simple Function-private state.

## Typed collections

A collection is a Project resource with immutable JSON Schema versions and
declared PostgreSQL indexes. Records are separated by environment; there is no
tenant partition inside a collection. Schema versions and Function grants affect
runtime traffic only after a Project deployment; production receives them through
the normal immutable release process.

Functions access granted collections through `ctx.collections`:

```ts
const customers = ctx.collections.collection<{
  name: string;
  status?: string;
  score?: number;
}>("customers");

const page = await customers.query({
  where: {
    and: [
      { field: "status", op: "eq", value: "active" },
      { field: "score", op: "gte", value: 10 },
    ],
  },
  orderBy: [{ field: "score", direction: "desc" }],
  limit: 50,
});
```

Available operations are `create`, `get`, `query`, `count`, `update`, and `delete`. Updates and deletes require the current record revision. Filtering, ordering, counting, limits, and cursor predicates execute in PostgreSQL; records are never fetched wholesale for application-side filtering.

Collections support explicit `read`, `write`, and `delete` Function grants.
Calls without the needed grant, invalid schemas, and stale revisions fail safely.

Declared B-tree indexes support scalar/composite filtering and sorting. GIN indexes support JSON or array containment. Unindexed queries remain bounded and database-side but may scan, so the Storage page displays declared index coverage for review.

## Record inspector

Owners and admins can select an environment, run the same bounded query DSL,
create or edit schema-validated JSON records, and permanently delete records with
revision checks. Developers can manage collection schemas but cannot inspect
record values. Every mutation creates an immutable audit event.

## Cache inspector

Cache inspection uses Redis `SCAN`, not `KEYS`. Owners and admins can filter by tenant or key prefix and inspect key scope, TTL, and serialized size. Revealing a value is an audited operation and is limited to 256 KiB. Known platform secret values, bearer tokens, and secret-like fields are always masked. Individual keys may be deleted with an audited operation.
