"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Command, ShieldCheck } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Badge, Button, Skeleton } from "@/components/ui";

type Approval = {
  clientName: string;
  redirectUri: string;
  scopes: string[];
  user: { email: string; role: string };
};

function Consent() {
  const requestId = useSearchParams().get("request");
  const [approval, setApproval] = useState<Approval>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!requestId) { setError("Missing authorization request."); return; }
    api<Approval>(`/api/oauth/requests/${encodeURIComponent(requestId)}`).then(setApproval).catch((reason) => setError(errorMessage(reason)));
  }, [requestId]);
  async function decide(approve: boolean) {
    if (!requestId) return;
    setBusy(true); setError(undefined);
    try {
      const result = await api<{ redirectTo: string }>(`/api/oauth/requests/${encodeURIComponent(requestId)}/decision`, { method: "POST", body: JSON.stringify({ approve }) });
      window.location.assign(result.redirectTo);
    } catch (reason) { setError(errorMessage(reason)); setBusy(false); }
  }
  return (
    <main className="grid min-h-screen place-items-center bg-muted/30 px-5 py-10">
      <section className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-panel">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Command size={19} /></span>
          <div><p className="text-sm font-semibold">Authorize IDE access</p><p className="text-xs text-muted-foreground">MCP Ops Studio Platform</p></div>
        </div>
        {error && <div className="mt-5 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600" role="alert">{error}</div>}
        {!approval && !error && <Skeleton className="mt-6 h-48" />}
        {approval && <>
          <div className="mt-6 rounded-xl border p-4">
            <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-primary" /><p className="text-sm font-semibold">{approval.clientName}</p></div>
            <p className="mt-2 break-all text-[11px] text-muted-foreground">Redirect: {approval.redirectUri}</p>
            <p className="mt-4 text-xs">Signed in as <strong>{approval.user.email}</strong> ({approval.user.role})</p>
            <div className="mt-4 flex flex-wrap gap-2">{approval.scopes.map((scope) => <Badge key={scope} tone="primary">{scope}</Badge>)}</div>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">The client can only use capabilities shown above and allowed by your installation-wide role. Project selection happens separately inside each MCP session.</p>
          <div className="mt-6 flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => void decide(false)}>Deny</Button><Button loading={busy} onClick={() => void decide(true)}>Authorize</Button></div>
        </>}
      </section>
    </main>
  );
}

export default function ConsentPage() { return <Suspense fallback={<main className="grid min-h-screen place-items-center"><Skeleton className="h-80 w-full max-w-lg" /></main>}><Consent /></Suspense>; }
