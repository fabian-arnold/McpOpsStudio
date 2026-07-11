import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Code2,
  ServerCog,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { AppShell } from "@/components/shell";
import { Badge, PageHeader } from "@/components/ui";

const sections = [
  {
    title: "Function programming model",
    description:
      "Author one TypeScript handler and expose an immutable version through MCP, HTTP, or both.",
    icon: Code2,
    href: "/functions",
  },
  {
    title: "MCP Endpoints",
    description:
      "Assign reusable project Functions as tools and deploy independent MCP endpoints.",
    icon: TerminalSquare,
    href: "/mcp-endpoints",
  },
  {
    title: "Deployments and rollback",
    description:
      "Build validated snapshots, inspect checksums and logs, and restore a prior immutable version.",
    icon: ServerCog,
    href: "/deployments",
  },
  {
    title: "Security and audit",
    description:
      "Review trusted-code isolation, secret grants, authorization outcomes, and immutable audit events.",
    icon: ShieldCheck,
    href: "/audit",
  },
];

export default function DocsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Reference"
        title="Documentation"
        description="Practical entry points for developing and operating MCP Ops Studio."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map(({ title, description, icon: Icon, href }) => (
          <Link
            className="panel group flex gap-4 p-5 transition hover:border-primary/30"
            href={href}
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
          </Link>
        ))}
      </div>
      <section className="panel mt-5 p-5">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-primary" />
          <h2 className="text-sm font-semibold">Local quick reference</h2>
          <Badge tone="info">development</Badge>
        </div>
        <div className="mt-4 grid gap-3 font-mono text-[11px] md:grid-cols-2">
          <code className="rounded-lg bg-muted/50 p-3">
            MCP http://localhost:8080/mcp/acme/customer-operations
          </code>
          <code className="rounded-lg bg-muted/50 p-3">
            HTTP http://localhost:8080/http/acme/customer-operations
          </code>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          The repository README and files under <code>docs/</code> contain
          setup, security, architecture, manifest, and contribution details.
        </p>
      </section>
    </AppShell>
  );
}
