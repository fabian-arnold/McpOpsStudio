import Link from "next/link";

const sourceUrl = "https://github.com/fabian-arnold/McpOpsStudio";

export default function LegalPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-16">
      <article className="mx-auto max-w-3xl rounded-2xl border bg-card p-8 shadow-panel sm:p-12">
        <p className="eyebrow">Legal notices</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">MCP Ops Studio</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Copyright © 2026 MCP Ops Studio contributors
        </p>

        <div className="mt-8 space-y-5 text-sm leading-7 text-muted-foreground">
          <p>
            MCP Ops Studio is free software: you can redistribute it and/or modify it
            under the terms of the GNU Affero General Public License as published by the
            Free Software Foundation, either version 3 of the License, or (at your
            option) any later version.
          </p>
          <p>
            This program is distributed in the hope that it will be useful, but WITHOUT
            ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
            FITNESS FOR A PARTICULAR PURPOSE.
          </p>
          <p>
            Third-party components remain under their respective licenses and copyright
            notices.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition hover:brightness-110"
            href={sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            Get source code
          </a>
          <a
            className="inline-flex h-9 items-center justify-center rounded-lg border bg-card px-3.5 text-sm font-medium transition hover:bg-muted"
            href={`${sourceUrl}/blob/main/LICENSE`}
            rel="noreferrer"
            target="_blank"
          >
            Read the license
          </a>
          <Link
            className="inline-flex h-9 items-center justify-center rounded-lg border bg-card px-3.5 text-sm font-medium transition hover:bg-muted"
            href="/"
          >
            Return to application
          </Link>
        </div>
      </article>
    </main>
  );
}
