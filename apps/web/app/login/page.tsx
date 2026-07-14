"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Command,
  Eye,
  EyeOff,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<{ required: boolean }>("/api/setup/status")
      .then((status) => {
        if (status.required) router.replace("/setup");
      })
      .catch(() => undefined);
  }, [router]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(undefined);
    try {
      const session = await api<{ user: { mustChangePassword?: boolean } }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      router.push(session.user.mustChangePassword ? "/change-password" : "/");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="grid min-h-screen bg-card lg:grid-cols-[1fr_1.08fr]">
      <section className="flex min-h-screen items-center justify-center px-6 py-12">
        <div className="w-full max-w-[390px]">
          <div className="mb-10 flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-[11px] bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/20">
              <Command size={19} />
            </span>
            <span className="font-semibold tracking-tight">MCP Ops Studio</span>
          </div>
          <p className="eyebrow mb-3">Control plane</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome back
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sign in to build, deploy, and observe your operations functions.
          </p>
          <form className="mt-8 space-y-4" onSubmit={submit}>
            <div>
              <label className="label" htmlFor="email">
                Email address
              </label>
              <input
                id="email"
                className="field h-10"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div>
              <div>
                <label className="label" htmlFor="password">
                  Password
                </label>
              </div>
              <div className="relative">
                <input
                  id="password"
                  className="field h-10 pr-10"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute right-1 top-1 grid size-8 place-items-center text-muted-foreground"
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-600 dark:text-red-400"
              >
                {error}
              </div>
            )}
            <Button className="h-10 w-full" loading={loading} type="submit">
              Sign in <ArrowRight size={15} />
            </Button>
          </form>
          <p className="mt-8 text-center text-[11px] text-muted-foreground">
            Self-hosted · Your code and data stay in your infrastructure
          </p>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            <a className="hover:text-foreground hover:underline" href="/legal">
              Legal notices
            </a>{" "}
            ·{" "}
            <a
              className="hover:text-foreground hover:underline"
              href="https://github.com/fabian-arnold/McpOpsStudio"
              rel="noreferrer"
              target="_blank"
            >
              Source code
            </a>
          </p>
        </div>
      </section>
      <section className="relative hidden min-h-screen overflow-hidden border-l bg-[#0b0c14] lg:block">
        <div className="dot-grid absolute inset-0 opacity-25" />
        <div className="absolute -left-28 top-1/3 size-96 rounded-full bg-violet-600/20 blur-[100px]" />
        <div className="absolute -right-28 bottom-10 size-96 rounded-full bg-indigo-600/15 blur-[100px]" />
        <div className="relative flex h-full flex-col justify-center px-[12%]">
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-400">
            Code-first operations
          </p>
          <h2 className="mt-5 max-w-xl text-4xl font-semibold leading-[1.15] tracking-tight text-white">
            One function.
            <br />
            <span className="text-slate-500">Every operational surface.</span>
          </h2>
          <p className="mt-5 max-w-lg text-sm leading-7 text-slate-400">
            Author TypeScript once, deploy an immutable snapshot, then expose it
            through MCP tools and secure HTTP handlers.
          </p>
          <div className="mt-10 max-w-xl overflow-hidden rounded-xl border border-white/10 bg-white/[.035] shadow-2xl">
            <div className="flex h-10 items-center gap-2 border-b border-white/10 px-4">
              <span className="size-2.5 rounded-full bg-red-400/70" />
              <span className="size-2.5 rounded-full bg-amber-400/70" />
              <span className="size-2.5 rounded-full bg-emerald-400/70" />
              <span className="ml-2 text-[11px] text-slate-500">
                search_customers.ts
              </span>
            </div>
            <pre className="overflow-hidden p-5 font-mono text-[12px] leading-6 text-slate-300">
              <span className="text-violet-400">
                export default async function
              </span>{" "}
              handler(ctx, input) {`{`}
              <br /> <span className="text-sky-300">ctx.logger.info</span>(
              <span className="text-emerald-300">
                &quot;Searching customers&quot;
              </span>
              );
              <br /> <span className="text-violet-400">return await</span>{" "}
              ctx.http.request({`{`}
              <br /> method:{" "}
              <span className="text-emerald-300">&quot;GET&quot;</span>,<br />{" "}
              url:{" "}
              <span className="text-emerald-300">
                `${`$`}
                {`{`}ctx.env.CRM_API_URL{`}`}/customers`
              </span>
              <br /> {`}`});
              <br />
              {`}`}
            </pre>
          </div>
          <div className="mt-8 grid max-w-xl grid-cols-3 gap-4 text-xs text-slate-400">
            {["Immutable deploys", "MCP + HTTP", "Execution audit"].map(
              (item) => (
                <div className="flex items-center gap-2" key={item}>
                  <span className="grid size-5 place-items-center rounded-full bg-violet-500/15 text-violet-400">
                    <Check size={12} />
                  </span>
                  {item}
                </div>
              ),
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
