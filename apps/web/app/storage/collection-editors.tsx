"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Dialog } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { DataCollection } from "@/lib/types";

const starterSchema = JSON.stringify(
  {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1 },
      status: { type: "string" },
    },
  },
  null,
  2,
);
const starterIndexes = JSON.stringify(
  [{ name: "by_status", kind: "btree", fields: ["status"], unique: false }],
  null,
  2,
);

export function CreateCollection({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [schema, setSchema] = useState(starterSchema);
  const [indexes, setIndexes] = useState(starterIndexes);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  async function create() {
    setBusy(true);
    setMessage(undefined);
    try {
      await api("/api/data-collections", {
        method: "POST",
        body: JSON.stringify({
          name,
          slug,
          description,
          schema: JSON.parse(schema),
          indexes: JSON.parse(indexes),
        }),
      });
      setOpen(false);
      onCreated();
    } catch (reason) {
      setMessage(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="icon" aria-label="Create collection">
          <Plus size={14} />
        </Button>
      }
      title="Create data collection"
      description="The schema becomes immutable version 1. Grant and deploy it before writing records."
    >
      <div className="space-y-3">
        <input
          className="field"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="field font-mono"
          placeholder="slug_with_underscores"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <textarea
          className="field min-h-20"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label className="label" htmlFor="new-collection-schema">
          JSON Schema
        </label>
        <textarea
          id="new-collection-schema"
          className="field min-h-64 font-mono text-xs"
          value={schema}
          onChange={(e) => setSchema(e.target.value)}
        />
        <label className="label" htmlFor="new-collection-indexes">
          PostgreSQL indexes
        </label>
        <textarea
          id="new-collection-indexes"
          className="field min-h-32 font-mono text-xs"
          value={indexes}
          onChange={(e) => setIndexes(e.target.value)}
        />
        {message && <p className="text-xs text-red-500">{message}</p>}
        <Button className="w-full" loading={busy} onClick={() => void create()}>
          Create collection
        </Button>
      </div>
    </Dialog>
  );
}

export function NewCollectionVersion({
  collection,
  onCreated,
}: {
  collection: DataCollection;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [schema, setSchema] = useState(
    JSON.stringify(collection.latestVersion?.schema ?? {}, null, 2),
  );
  const [indexes, setIndexes] = useState(
    JSON.stringify(collection.latestVersion?.indexes ?? [], null, 2),
  );
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    setMessage(undefined);
    try {
      await api(`/api/data-collections/${collection.id}/versions`, {
        method: "POST",
        body: JSON.stringify({
          schema: JSON.parse(schema),
          indexes: JSON.parse(indexes),
        }),
      });
      setOpen(false);
      onCreated();
    } catch (reason) {
      setMessage(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" variant="secondary">
          New version
        </Button>
      }
      title={`Create ${collection.slug} schema version`}
      description="Existing records allow only conservative compatible changes. Runtime traffic changes after deployment."
    >
      <label className="label" htmlFor="collection-version-schema">
        JSON Schema
      </label>
      <textarea
        id="collection-version-schema"
        className="field min-h-64 font-mono text-xs"
        value={schema}
        onChange={(event) => setSchema(event.target.value)}
      />
      <label className="label mt-3" htmlFor="collection-version-indexes">
        PostgreSQL indexes
      </label>
      <textarea
        id="collection-version-indexes"
        className="field min-h-36 font-mono text-xs"
        value={indexes}
        onChange={(event) => setIndexes(event.target.value)}
      />
      {message && <p className="mt-2 text-xs text-red-500">{message}</p>}
      <Button className="mt-4 w-full" loading={busy} onClick={() => void create()}>
        Create immutable version
      </Button>
    </Dialog>
  );
}
