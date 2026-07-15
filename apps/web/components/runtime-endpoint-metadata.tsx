"use client";

import { useEffect, useState } from "react";
import { Copy, Download, FileJson2 } from "lucide-react";
import { useToast } from "@/components/providers";
import { Button, LoadError, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { downloadText } from "@/lib/download";
import type { RuntimeEndpointDetail } from "@/lib/types";

import { Manifest } from "./runtime-endpoint-operations";

type DocumentFormat =
  | "openapi-json"
  | "openapi-yaml"
  | "postman"
  | "mcp-client"
  | "manifest-json"
  | "manifest-yaml";

type DiscoveryDocument = {
  format: DocumentFormat;
  filename: string;
  mediaType: string;
  content: string;
  formats: DocumentFormat[];
  containsSecretValues: false;
};

const formatDetails: Record<DocumentFormat, { label: string; description: string }> = {
  "openapi-json": {
    label: "openapi.json",
    description: "OpenAPI 3.1 JSON for client generation and API tooling.",
  },
  "openapi-yaml": {
    label: "openapi.yaml",
    description: "OpenAPI 3.1 YAML for documentation and source control.",
  },
  postman: {
    label: "Postman collection",
    description: "Postman Collection 2.1 with requests and auth placeholders.",
  },
  "mcp-client": {
    label: "mcp.json",
    description: "Streamable HTTP MCP client configuration for each environment.",
  },
  "manifest-json": {
    label: "manifest.json",
    description: "Portable endpoint metadata in JSON.",
  },
  "manifest-yaml": {
    label: "manifest.yaml",
    description: "Portable endpoint metadata in YAML.",
  },
};

const formatsByKind: Record<"mcp" | "http", DocumentFormat[]> = {
  http: ["openapi-json", "openapi-yaml", "postman", "manifest-json", "manifest-yaml"],
  mcp: ["mcp-client", "manifest-json", "manifest-yaml"],
};

export function EndpointMetadata({ endpoint }: { endpoint: RuntimeEndpointDetail }) {
  const toast = useToast();
  const formats = formatsByKind[endpoint.kind];
  const [format, setFormat] = useState<DocumentFormat>(formats[0]!);
  const [document, setDocument] = useState<DiscoveryDocument>();
  const [loadError, setLoadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!formats.includes(format)) setFormat(formats[0]!);
  }, [format, formats]);

  useEffect(() => {
    let active = true;
    setDocument(undefined);
    setLoadError(undefined);
    api<DiscoveryDocument>(
      `/api/runtime-endpoints/${endpoint.id}/discovery?format=${format}`,
    )
      .then((value) => active && setDocument(value))
      .catch((reason) => active && setLoadError(errorMessage(reason)));
    return () => {
      active = false;
    };
  }, [attempt, endpoint.id, format]);

  async function copyDocument() {
    if (!document) return;
    try {
      await navigator.clipboard.writeText(document.content);
      toast({ title: `${document.filename} copied`, tone: "success" });
    } catch {
      toast({
        title: "Copy failed",
        description: "Copy the document directly from the preview.",
        tone: "error",
      });
    }
  }

  return (
    <div className="space-y-5">
      <section className="panel overflow-hidden">
        <div className="border-b p-4">
          <div className="flex items-center gap-2">
            <FileJson2 size={16} className="text-primary" />
            <h2 className="text-sm font-semibold">Client metadata</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Generated from bindings and Function contracts. Credentials remain
            placeholders and secret values are never included.
          </p>
          <div className="mt-4 flex flex-wrap gap-2" role="tablist">
            {formats.map((item) => (
              <button
                aria-selected={format === item}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                  format === item
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                key={item}
                onClick={() => setFormat(item)}
                role="tab"
                type="button"
              >
                {formatDetails[item].label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b bg-muted/20 px-4 py-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs font-semibold">
              {document?.filename ?? formatDetails[format].label}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {formatDetails[format].description}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={!document}
              onClick={() => void copyDocument()}
              size="sm"
              variant="secondary"
            >
              <Copy size={13} /> Copy
            </Button>
            <Button
              disabled={!document}
              onClick={() =>
                document &&
                downloadText(document.filename, document.content, document.mediaType)
              }
              size="sm"
            >
              <Download size={13} /> Download
            </Button>
          </div>
        </div>

        {loadError ? (
          <div className="p-4">
            <LoadError
              title="Metadata unavailable"
              message={loadError}
              onRetry={() => setAttempt((value) => value + 1)}
            />
          </div>
        ) : !document ? (
          <Skeleton className="m-4 h-80" />
        ) : (
          <textarea
            aria-label={`${formatDetails[format].label} preview`}
            className="min-h-80 w-full resize-y bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 outline-none"
            readOnly
            spellCheck={false}
            value={document.content}
          />
        )}
      </section>

      <Manifest endpoint={endpoint} />
    </div>
  );
}
