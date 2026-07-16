"use client";
import { type FormEvent, useMemo, useState } from "react";
import { Link2 } from "lucide-react";
import { useToast } from "@/components/providers";
import { Button, Dialog } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { RuntimeEndpointDetail } from "@/lib/types";
import type { QueryGrant, ReviewedQuery } from "./reviewed-database-types";
import { FormError } from "./reviewed-database-fields";

export function GrantDialog({
  endpoint,
  queries,
  onChanged,
}: {
  endpoint: RuntimeEndpointDetail;
  queries: ReviewedQuery[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const versions = useMemo(
    () =>
      queries.flatMap((query) =>
        query.connection.enabled
          ? query.versions
              .filter((version) => version.enabled)
              .map((version) => ({ ...version, query }))
          : [],
      ),
    [queries],
  );
  const [open, setOpen] = useState(false);
  const [functionId, setFunctionId] = useState(endpoint.functions[0]?.id ?? "");
  const [queryVersionId, setQueryVersionId] = useState(versions[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string>();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(undefined);
    try {
      await api(`/api/functions/${functionId}/database-query-grants`, {
        method: "POST",
        body: JSON.stringify({ queryVersionId }),
      });
      toast({
        title: "Exact query version granted",
        description: "The function cannot execute other queries or versions.",
        tone: "success",
      });
      setOpen(false);
      onChanged();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" disabled={!endpoint.functions.length || !versions.length}>
          <Link2 size={13} />
          Grant
        </Button>
      }
      title="Grant an exact query version"
      description="A function receives capability access to this version only. No raw SQL or connection credential is exposed."
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="reviewed-grant-function">
            Function
          </label>
          <select
            id="reviewed-grant-function"
            className="field"
            value={functionId}
            onChange={(event) => setFunctionId(event.target.value)}
          >
            {endpoint.functions.map((fn) => (
              <option value={fn.id} key={fn.id}>
                {fn.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="reviewed-grant-version">
            Reviewed version
          </label>
          <select
            id="reviewed-grant-version"
            className="field"
            value={queryVersionId}
            onChange={(event) => setQueryVersionId(event.target.value)}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.query.queryId} · version {version.version} ·{" "}
                {version.query.connection.name}
              </option>
            ))}
          </select>
        </div>
        {formError && <FormError message={formError} />}
        <div className="flex justify-end">
          <Button loading={saving} disabled={!functionId || !queryVersionId}>
            Grant exact version
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function GrantRow({
  grant,
  endpoint,
  onChanged,
}: {
  grant: QueryGrant;
  endpoint: RuntimeEndpointDetail;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const fn = endpoint.functions.find((item) => item.id === grant.functionId);
  async function revoke() {
    setSaving(true);
    try {
      await api(
        `/api/functions/${grant.functionId}/database-query-grants/${grant.id}`,
        { method: "DELETE" },
      );
      toast({ title: "Query grant revoked", tone: "success" });
      onChanged();
    } catch (error) {
      toast({
        title: "Grant could not be revoked",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded border bg-card p-2.5">
      <div>
        <p className="font-mono text-[11px]">{fn?.name ?? "Unknown function"}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Exact version {grant.query.version}
          {!grant.query.versionEnabled || !grant.query.connection.enabled
            ? " · source disabled"
            : ""}
        </p>
      </div>
      <Button variant="ghost" size="sm" loading={saving} onClick={revoke}>
        Revoke
      </Button>
    </div>
  );
}
