"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Command, ShieldCheck } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui";

type Starter = "clean" | "notes-demo";
type SetupResult = {
  starter: Starter;
  deployment: { id: string; status: string } | null;
};

export default function SetupPage() {
  const router = useRouter();
  const [setupCode, setSetupCode] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [projectName, setProjectName] = useState("My Project");
  const [projectSlug, setProjectSlug] = useState("my-project");
  const [slugEdited, setSlugEdited] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");
  const [starter, setStarter] = useState<Starter>("clean");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<SetupResult>();

  useEffect(() => {
    setPublicUrl(window.location.origin);
    api<{ required: boolean }>("/api/setup/status")
      .then((status) => {
        if (!status.required) router.replace("/login");
      })
      .catch((cause) => setError(errorMessage(cause)));
  }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(undefined);
    try {
      setResult(
        await api<SetupResult>("/api/setup", {
          method: "POST",
          body: JSON.stringify({
            setupCode,
            ownerEmail,
            ownerPassword,
            projectName,
            projectSlug,
            publicUrl,
            starter,
          }),
        }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  if (result)
    return (
      <SetupShell>
        <div className="grid size-12 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Check size={24} />
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">
          Installation ready
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Your owner account and Project were created successfully.
        </p>
        {result.starter === "notes-demo" && (
          <div className="mt-6 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm">
            <p className="font-semibold text-amber-700 dark:text-amber-300">
              Note App demo deployment queued
            </p>
            <p className="mt-2 text-muted-foreground">
              MCP and HTTP Basic authentication: <code>DEMO</code> / <code>DEMO</code>.
              These credentials are publicly known and must not be used for real
              exposure.
            </p>
          </div>
        )}
        <Button className="mt-7 w-full" onClick={() => router.push("/")}>
          Open MCP Ops Studio
        </Button>
      </SetupShell>
    );

  return (
    <SetupShell>
      <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
        <ShieldCheck size={18} />
        <span className="text-xs font-semibold uppercase tracking-[.14em]">
          One-time installation
        </span>
      </div>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">
        Set up MCP Ops Studio
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Create the installation owner and first Project. Setup closes permanently when
        this form succeeds.
      </p>
      <form className="mt-7 space-y-5" onSubmit={submit}>
        <Field
          label="Setup code"
          hint="Run docker compose logs --no-log-prefix mcpops-config"
        >
          <input
            className="field font-mono"
            value={setupCode}
            onChange={(event) => setSetupCode(event.target.value.trim())}
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner email">
            <input
              className="field"
              type="email"
              autoComplete="email"
              value={ownerEmail}
              onChange={(event) => setOwnerEmail(event.target.value)}
              required
            />
          </Field>
          <Field label="Owner password" hint="At least 12 characters">
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={ownerPassword}
              onChange={(event) => setOwnerPassword(event.target.value)}
              required
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project name">
            <input
              className="field"
              value={projectName}
              onChange={(event) => {
                const value = event.target.value;
                setProjectName(value);
                if (!slugEdited) setProjectSlug(slugify(value));
              }}
              required
            />
          </Field>
          <Field label="Project slug">
            <input
              className="field font-mono"
              value={projectSlug}
              onChange={(event) => {
                setSlugEdited(true);
                setProjectSlug(slugify(event.target.value));
              }}
              required
            />
          </Field>
        </div>
        <Field
          label="Public URL"
          hint="Use HTTPS outside localhost; this becomes the Development and Production endpoint origin"
        >
          <input
            className="field"
            type="url"
            value={publicUrl}
            onChange={(event) => setPublicUrl(event.target.value)}
            required
          />
        </Field>
        <div>
          <p className="label">Starter</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <StarterCard
              active={starter === "clean"}
              title="Clean Project"
              description="Start with empty Development and Production environments."
              onClick={() => setStarter("clean")}
            />
            <StarterCard
              active={starter === "notes-demo"}
              title="Note App demo"
              description="Persistence, MCP and HTTP with DEMO / DEMO Basic auth."
              onClick={() => setStarter("notes-demo")}
            />
          </div>
        </div>
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
        <Button className="h-10 w-full" loading={loading} type="submit">
          Complete setup
        </Button>
      </form>
    </SetupShell>
  );
}

function SetupShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-muted/25 px-5 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-[11px] bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
            <Command size={19} />
          </span>
          <span className="font-semibold tracking-tight">MCP Ops Studio</span>
        </div>
        <section className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          {children}
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && (
        <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

function StarterCard({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-xl border p-4 text-left transition ${active ? "border-violet-500 bg-violet-500/10" : "hover:border-violet-500/40"}`}
      type="button"
      onClick={onClick}
    >
      <span className="text-sm font-semibold">{title}</span>
      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
        {description}
      </span>
    </button>
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
