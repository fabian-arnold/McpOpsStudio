"use client";

import { Copy } from "lucide-react";
import { useToast } from "@/components/providers";
import { cn } from "@/lib/cn";
import type { EndpointUrls } from "@/lib/types";

const environments = [
  { slug: "development", label: "Development" },
  { slug: "production", label: "Production" },
] as const;

export function EnvironmentEndpointUrls({
  kind,
  urls,
  fallback,
  className,
}: {
  kind: "mcp" | "http";
  urls?: Record<string, EndpointUrls> | undefined;
  fallback?: EndpointUrls | undefined;
  className?: string | undefined;
}) {
  const toast = useToast();

  return (
    <div className={cn("divide-y rounded-lg border bg-muted/20", className)}>
      {environments.map((environment) => {
        const endpointUrls =
          urls?.[environment.slug] ??
          (environment.slug === "development" ? fallback : undefined);
        const value = kind === "mcp" ? endpointUrls?.mcpUrl : endpointUrls?.httpBaseUrl;
        return (
          <div
            className="flex min-w-0 items-center gap-3 px-3 py-2.5"
            key={environment.slug}
          >
            <span className="w-20 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {environment.label}
            </span>
            <code className="min-w-0 flex-1 truncate text-[10px]">
              {value ?? "Not configured"}
            </code>
            {value && (
              <button
                type="button"
                className="text-muted-foreground transition hover:text-foreground"
                onClick={() =>
                  navigator.clipboard.writeText(value).then(() =>
                    toast({
                      title: `${environment.label} endpoint copied`,
                      tone: "success",
                    }),
                  )
                }
                aria-label={`Copy ${environment.label} endpoint`}
              >
                <Copy size={13} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
