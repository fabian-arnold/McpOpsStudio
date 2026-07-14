import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Code2,
  Rocket,
  ServerCog,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { AppShell } from "@/components/shell";
import { Badge, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const defaultDocsUrl = "https://fabian-arnold.github.io/McpOpsStudio/";

function docsHref(base: string, path: string) {
  return new URL(
    path.replace(/^\//, ""),
    base.endsWith("/") ? base : `${base}/`,
  ).toString();
}

export default function DocsPage() {
  const docsUrl = process.env.NEXT_PUBLIC_DOCS_URL ?? defaultDocsUrl;
  const userGuides = [
    {
      title: "Get started",
      description:
        "Install the app, create the owner and first Project, then publish a Function.",
      icon: Rocket,
      path: "getting-started",
    },
    {
      title: "Use the application",
      description:
        "Learn every menu page, editor, binding table, setting, and operational view.",
      icon: BookOpen,
      path: "app/navigation",
    },
    {
      title: "Build Functions",
      description:
        "Author TypeScript, schemas and policy, then validate and test a saved version.",
      icon: Code2,
      path: "app/function-editor",
    },
    {
      title: "Publish MCP and HTTP",
      description:
        "Expose reusable Functions as authenticated MCP tools and typed HTTP routes.",
      icon: TerminalSquare,
      path: "app/endpoints",
    },
    {
      title: "Secure endpoints",
      description:
        "Configure encrypted Secrets, authentication policies, permissions, and networking.",
      icon: ShieldCheck,
      path: "guides/secure-endpoint",
    },
    {
      title: "Deploy and operate",
      description:
        "Build Development snapshots, release to Production, observe calls, and roll back.",
      icon: ServerCog,
      path: "guides/release-and-rollback",
    },
  ];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Learn"
        title="Documentation"
        description="Guides for developers who install, build with, and operate MCP Ops Studio."
        actions={
          <a
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition hover:brightness-110"
            href={docsHref(docsUrl, "getting-started")}
            target="_blank"
            rel="noreferrer"
          >
            Open documentation <ArrowRight size={14} />
          </a>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {userGuides.map(({ title, description, icon: Icon, path }) => (
          <a
            className="panel group flex gap-4 p-5 transition hover:border-primary/30"
            href={docsHref(docsUrl, path)}
            target="_blank"
            rel="noreferrer"
            key={title}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon size={18} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-semibold">
                {title}
                <ArrowRight
                  className="opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100"
                  size={13}
                />
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {description}
              </span>
            </span>
          </a>
        ))}
      </div>
      <section className="panel mt-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
          <Code2 size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Develop MCP Ops Studio</h2>
            <Badge tone="info">contributors</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Explore architecture, repository development, testing, migrations, security
            controls, and release practices.
          </p>
        </div>
        <a
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border bg-card px-3.5 text-sm font-medium transition hover:bg-muted"
          href={docsHref(docsUrl, "contributing/platform-development")}
          target="_blank"
          rel="noreferrer"
        >
          Contributor guide <ArrowRight size={14} />
        </a>
      </section>
      <p className="mt-5 text-xs text-muted-foreground">
        Looking for a product screen? Use the application navigation or return to the{" "}
        <Link className="text-primary hover:underline" href="/">
          Dashboard
        </Link>
        .
      </p>
    </AppShell>
  );
}
