"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Braces,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileJson2,
  ServerCog,
  TerminalSquare,
} from "lucide-react";
import { AppShell } from "@/components/shell";
import { EnvironmentEndpointUrls } from "@/components/environment-endpoint-urls";
import { useToast } from "@/components/providers";
import {
  Badge,
  Button,
  EmptyState,
  LoadError,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { downloadText } from "@/lib/download";
import type { RuntimeEndpoint } from "@/lib/types";

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

const formatDetails: Record<
  DocumentFormat,
  { label: string; description: string }
> = {
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
    description: "Portable MCP Ops Studio endpoint manifest in JSON.",
  },
  "manifest-yaml": {
    label: "manifest.yaml",
    description: "Portable MCP Ops Studio endpoint manifest in YAML.",
  },
};

const formatsByKind: Record<"mcp" | "http", DocumentFormat[]> = {
  http: [
    "openapi-json",
    "openapi-yaml",
    "postman",
    "manifest-json",
    "manifest-yaml",
  ],
  mcp: ["mcp-client", "manifest-json", "manifest-yaml"],
};

export default function EndpointsPage() {
  const toast = useToast();
  const [endpoints, setEndpoints] = useState<RuntimeEndpoint[]>();
  const [selectedId, setSelectedId] = useState("");
  const [format, setFormat] = useState<DocumentFormat>("openapi-json");
  const [document, setDocument] = useState<DiscoveryDocument>();
  const [loadError, setLoadError] = useState<string>();
  const [documentError, setDocumentError] = useState<string>();

  useEffect(() => {
    let active = true;
    api<RuntimeEndpoint[]>("/api/runtime-endpoints")
      .then((items) => {
        if (!active) return;
        setEndpoints(items);
        setSelectedId((current) => current || items[0]?.id || "");
      })
      .catch((error) => active && setLoadError(errorMessage(error)));
    return () => {
      active = false;
    };
  }, []);

  const selected = useMemo(
    () => endpoints?.find((endpoint) => endpoint.id === selectedId),
    [endpoints, selectedId],
  );
  const availableFormats = selected ? formatsByKind[selected.kind] : [];

  useEffect(() => {
    if (!selected) return;
    if (!formatsByKind[selected.kind].includes(format)) {
      setFormat(formatsByKind[selected.kind][0]!);
      return;
    }
    let active = true;
    setDocument(undefined);
    setDocumentError(undefined);
    api<DiscoveryDocument>(
      `/api/runtime-endpoints/${selected.id}/discovery?format=${format}`,
    )
      .then((value) => active && setDocument(value))
      .catch((error) => active && setDocumentError(errorMessage(error)));
    return () => {
      active = false;
    };
  }, [format, selected]);

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
    <AppShell>
      <PageHeader
        eyebrow="Project"
        title="Endpoints"
        description="Discover every MCP and HTTP endpoint in this Project and export client-ready API descriptions."
      />

      {loadError ? (
        <LoadError
          title="Endpoints unavailable"
          message={loadError}
          onRetry={() => window.location.reload()}
        />
      ) : !endpoints ? (
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Skeleton className="h-96" />
          <Skeleton className="h-[36rem]" />
        </div>
      ) : !endpoints.length ? (
        <EmptyState
          icon={<Braces />}
          title="No endpoints yet"
          description="Create an MCP Endpoint or HTTP API to publish project Functions."
          action={
            <div className="flex gap-2">
              <Link
                className="inline-flex h-9 items-center rounded-lg border bg-card px-3.5 text-sm font-medium hover:bg-muted"
                href="/mcp-endpoints"
              >
                MCP Endpoints
              </Link>
              <Link
                className="inline-flex h-9 items-center rounded-lg border bg-card px-3.5 text-sm font-medium hover:bg-muted"
                href="/http-apis"
              >
                HTTP APIs
              </Link>
            </div>
          }
        />
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="panel overflow-hidden xl:sticky xl:top-20">
            <div className="border-b p-4">
              <h2 className="text-sm font-semibold">Project endpoints</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {endpoints.length} configured endpoint{endpoints.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="max-h-[32rem] divide-y overflow-y-auto">
              {endpoints.map((endpoint) => {
                const selectedEndpoint = endpoint.id === selectedId;
                const Icon = endpoint.kind === "mcp" ? TerminalSquare : ServerCog;
                return (
                  <button
                    className={cn(
                      "flex w-full items-start gap-3 p-4 text-left transition hover:bg-muted/50",
                      selectedEndpoint && "bg-primary/5",
                    )}
                    key={endpoint.id}
                    onClick={() => setSelectedId(endpoint.id)}
                    type="button"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs font-semibold">
                          {endpoint.name}
                        </span>
                        {selectedEndpoint && <Check className="text-primary" size={13} />}
                      </span>
                      <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                        {endpoint.slug}
                      </span>
                      <span className="mt-2 flex items-center gap-2">
                        <Badge>{endpoint.kind.toUpperCase()}</Badge>
                        <Badge
                          tone={
                            endpoint.status === "deployed"
                              ? "success"
                              : endpoint.status === "failed"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {endpoint.status}
                        </Badge>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          {selected && (
            <div className="min-w-0 space-y-4">
              <section className="panel p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">{selected.name}</h2>
                      <Badge>{selected.kind.toUpperCase()}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selected.description || "No endpoint description provided."}
                    </p>
                  </div>
                  <Link
                    className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-xs font-medium hover:bg-muted"
                    href={`${selected.kind === "mcp" ? "/mcp-endpoints" : "/http-apis"}/${selected.id}`}
                  >
                    Configure
                    <ExternalLink size={13} />
                  </Link>
                </div>
                <EnvironmentEndpointUrls
                  className="mt-4"
                  kind={selected.kind}
                  urls={selected.environmentEndpoints}
                  fallback={selected.endpoints}
                />
              </section>

              <section className="panel overflow-hidden">
                <div className="border-b p-4">
                  <div className="flex items-center gap-2">
                    <FileJson2 size={16} className="text-primary" />
                    <h2 className="text-sm font-semibold">Discovery formats</h2>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Generated from current bindings and schemas. Credentials are placeholders; secret values are never included.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2" role="tablist">
                    {availableFormats.map((item) => (
                      <button
                        aria-selected={format === item}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-xs font-medium transition",
                          format === item
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
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
                      <Copy size={13} />
                      Copy
                    </Button>
                    <Button
                      disabled={!document}
                      onClick={() =>
                        document &&
                        downloadText(
                          document.filename,
                          document.content,
                          document.mediaType,
                        )
                      }
                      size="sm"
                    >
                      <Download size={13} />
                      Download
                    </Button>
                  </div>
                </div>

                {documentError ? (
                  <div className="p-4">
                    <LoadError
                      title="Document unavailable"
                      message={documentError}
                      onRetry={() => setFormat((current) => current)}
                    />
                  </div>
                ) : !document ? (
                  <Skeleton className="m-4 h-[32rem]" />
                ) : (
                  <textarea
                    aria-label={`${formatDetails[format].label} preview`}
                    className="min-h-[32rem] w-full resize-y bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 outline-none"
                    readOnly
                    spellCheck={false}
                    value={document.content}
                  />
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
