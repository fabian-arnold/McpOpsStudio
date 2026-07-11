"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Command, KeyRound } from "lucide-react";
import { Button } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export default function ChangePasswordPage() {
  const router = useRouter(); const [currentPassword, setCurrentPassword] = useState(""); const [newPassword, setNewPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string>();
  async function submit(event: FormEvent) { event.preventDefault(); if (newPassword !== confirm) { setError("Passwords do not match"); return; } setSaving(true); setError(undefined); try { await api("/api/account/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }); router.replace("/login"); } catch (reason) { setError(errorMessage(reason)); } finally { setSaving(false); } }
  return <main className="grid min-h-screen place-items-center bg-background p-6"><section className="panel w-full max-w-md p-7"><div className="flex items-center gap-2"><span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><Command size={17} /></span><h1 className="text-lg font-semibold">Change password</h1></div><p className="mt-3 text-sm text-muted-foreground">Replace your temporary or current local password. You will sign in again afterward.</p><form className="mt-6 space-y-4" onSubmit={submit}><div><label className="label">Current password</label><input className="field" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></div><div><label className="label">New password</label><input className="field" type="password" minLength={12} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /></div><div><label className="label">Confirm new password</label><input className="field" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>{error && <p className="text-xs text-red-500">{error}</p>}<Button className="w-full" type="submit" loading={saving}><KeyRound size={14} />Change password</Button></form></section></main>;
}
