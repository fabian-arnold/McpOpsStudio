"use client";
import { useCallback, useEffect, useState } from "react";
import { Database, FileCheck2 } from "lucide-react";
import { Badge, Button, EmptyState, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type { RuntimeEndpointDetail } from "@/lib/types";
import {
  ConnectionDialog,
  ConnectionRow,
  FeatureState,
} from "./reviewed-database-connections";
import { GrantDialog } from "./reviewed-database-grants";
import { QueryCard, QueryDialog } from "./reviewed-database-queries";
import type {
  Capabilities,
  Connection,
  QueryGrant,
  ReviewedQuery,
} from "./reviewed-database-types";

export function ReviewedDatabaseQueries({
  endpoint,
}: {
  endpoint: RuntimeEndpointDetail;
}) {
  const user = useCurrentUser();
  const [capability, setCapability] = useState<boolean>();
  const [capabilityError, setCapabilityError] = useState<string>();
  const [connections, setConnections] = useState<Connection[]>();
  const [queries, setQueries] = useState<ReviewedQuery[]>();
  const [grants, setGrants] = useState<QueryGrant[]>();
  const [loadError, setLoadError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const authorized = roleAllows(user?.role, ["owner", "admin"]);

  useEffect(() => {
    api<Capabilities>("/api/capabilities")
      .then((result) =>
        setCapability(result.runtimeCapabilities?.reviewedDatabaseQueries === true),
      )
      .catch((error) => setCapabilityError(errorMessage(error)));
  }, []);

  const load = useCallback(() => {
    if (!authorized || capability !== true) return;
    setLoadError(undefined);
    const environmentId = encodeURIComponent(endpoint.environment.id);
    Promise.all([
      api<{ connections: Connection[] }>(
        `/api/database/connections?environmentId=${environmentId}`,
      ),
      api<{ queries: ReviewedQuery[] }>(
        `/api/database/queries?environmentId=${environmentId}`,
      ),
      Promise.all(
        endpoint.functions.map((fn) =>
          api<{ grants: QueryGrant[] }>(
            `/api/functions/${fn.id}/database-query-grants`,
          ),
        ),
      ),
    ])
      .then(([connectionResult, queryResult, grantResults]) => {
        setConnections(connectionResult.connections);
        setQueries(queryResult.queries);
        setGrants(grantResults.flatMap((result) => result.grants));
      })
      .catch((error) => setLoadError(errorMessage(error)));
  }, [authorized, capability, endpoint.environment.id, endpoint.functions]);

  useEffect(load, [load, refresh]);
  const changed = () => setRefresh((value) => value + 1);

  if (capabilityError) {
    return (
      <FeatureState
        title="Reviewed database queries unavailable"
        description={`Capability status could not be verified: ${capabilityError}`}
        tone="warning"
      />
    );
  }
  if (capability === undefined || user === undefined) {
    return <Skeleton className="h-40 lg:col-span-2" />;
  }
  if (!capability) {
    return (
      <FeatureState
        title="Reviewed database queries disabled"
        description="This deployment has not enabled the reviewed database query capability. Functions cannot receive query grants while it is disabled."
        tone="neutral"
      />
    );
  }
  if (!authorized) {
    return (
      <FeatureState
        title="Reviewed database queries restricted"
        description="Only project owners and admins can view reviewed SQL, manage connection metadata, or grant exact query versions."
        tone="warning"
      />
    );
  }
  if (loadError) {
    return (
      <FeatureState
        title="Reviewed query configuration unavailable"
        description={loadError}
        tone="warning"
        action={
          <Button variant="secondary" size="sm" onClick={changed}>
            Retry
          </Button>
        }
      />
    );
  }
  if (!connections || !queries || !grants) {
    return <Skeleton className="h-64 lg:col-span-2" />;
  }

  return (
    <section className="panel overflow-hidden lg:col-span-2">
      <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileCheck2 size={17} className="text-primary" />
            <h2 className="text-sm font-semibold">Reviewed database queries</h2>
            <Badge tone="success">Enabled</Badge>
          </div>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">
            Owner/admin-reviewed, immutable SELECT contracts. Runtime functions receive
            only explicit query-version grants; connection values remain encrypted
            environment secrets.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ConnectionDialog endpoint={endpoint} onChanged={changed} />
          <QueryDialog
            endpoint={endpoint}
            connections={connections.filter((item) => item.enabled)}
            onChanged={changed}
          />
          <GrantDialog endpoint={endpoint} queries={queries} onChanged={changed} />
        </div>
      </div>
      <div className="grid gap-5 p-5 xl:grid-cols-[0.8fr_1.2fr]">
        <div>
          <h3 className="text-xs font-semibold">Connection metadata</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Secret values and connection strings are never returned.
          </p>
          <div className="mt-3 space-y-2">
            {connections.length ? (
              connections.map((connection) => (
                <ConnectionRow
                  key={connection.id}
                  connection={connection}
                  onChanged={changed}
                />
              ))
            ) : (
              <EmptyState
                icon={<Database />}
                title="No reviewed connections"
                description="Create metadata that references an existing encrypted environment secret."
              />
            )}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-semibold">Immutable query versions</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            SQL is visible here only to authenticated owners and admins. It is never
            returned to runtime callers.
          </p>
          <div className="mt-3 space-y-3">
            {queries.length ? (
              queries.map((query) => (
                <QueryCard
                  key={query.id}
                  query={query}
                  grants={grants.filter(
                    (grant) => grant.queryDefinitionId === query.id,
                  )}
                  endpoint={endpoint}
                  onChanged={changed}
                />
              ))
            ) : (
              <EmptyState
                icon={<FileCheck2 />}
                title="No reviewed queries"
                description="Create a bounded read-only SELECT contract after adding a connection."
              />
            )}
          </div>
        </div>
      </div>
      <div className="border-t bg-muted/20 px-5 py-3 text-[10px] leading-5 text-muted-foreground">
        No raw SQL is exposed in the function editor or runtime context. Query
        definitions are reviewed control-plane resources and grants target one exact
        immutable version.
      </div>
    </section>
  );
}
