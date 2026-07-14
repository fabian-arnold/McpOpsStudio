"use client";

import { type FormEvent, useState } from "react";
import { Plus } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { RuntimeEndpoint } from "@/lib/types";
import { Button, Dialog } from "@/components/ui";
import { useToast } from "@/components/providers";
import { roleAllows, useCurrentUser } from "@/lib/session";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function EndpointCreateDialog({
  onCreated,
  kind,
  variant = "primary",
}: {
  onCreated: (endpoint: RuntimeEndpoint) => void;
  kind: "mcp" | "http";
  variant?: "primary" | "secondary";
}) {
  const user = useCurrentUser();
  const canCreate = roleAllows(user?.role, ["owner", "admin", "developer"]);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string>();
  function changeName(value: string) {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(undefined);
    try {
      const created = await api<RuntimeEndpoint>("/api/runtime-endpoints", {
        method: "POST",
        body: JSON.stringify({
          kind,
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim(),
        }),
      });
      toast({
        title: `${kind === "mcp" ? "MCP Endpoint" : "HTTP API"} created`,
        description: `${created.name} is ready for Function bindings.`,
        tone: "success",
      });
      setOpen(false);
      setName("");
      setSlug("");
      setDescription("");
      setSlugEdited(false);
      onCreated(created);
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
        <Button
          variant={variant}
          disabled={!canCreate}
          title={
            user
              ? canCreate
                ? `Create an ${kind === "mcp" ? "MCP Endpoint" : "HTTP API"}`
                : "Your role cannot create runtime endpoints"
              : "Loading permissions"
          }
        >
          <Plus size={15} />
          New {kind === "mcp" ? "MCP Endpoint" : "HTTP API"}
        </Button>
      }
      title={`Create ${kind === "mcp" ? "MCP Endpoint" : "HTTP API"}`}
      description="Create a development endpoint. Project releases promote its immutable snapshot to production."
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="endpoint-name">
            Name
          </label>
          <input
            id="endpoint-name"
            className="field"
            value={name}
            onChange={(event) => changeName(event.target.value)}
            minLength={2}
            maxLength={120}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="endpoint-slug">
            Slug
          </label>
          <input
            id="endpoint-slug"
            className="field font-mono"
            value={slug}
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(event.target.value.toLowerCase());
            }}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="endpoint-description">
            Description
          </label>
          <textarea
            id="endpoint-description"
            className="field min-h-24"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
          />
        </div>
        {formError && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400"
          >
            {formError}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={saving}
            disabled={!name.trim() || !slug.trim()}
          >
            Create endpoint
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
