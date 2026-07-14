"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { AppShell } from "@/components/shell";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  LoadError,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/providers";
import { api, errorMessage } from "@/lib/api";
import type { SessionIdentity, UserSummary } from "@/lib/types";

const roles = ["owner", "admin", "developer", "operator", "viewer"] as const;

export default function UsersPage() {
  const toast = useToast();
  const [users, setUsers] = useState<UserSummary[]>();
  const [me, setMe] = useState<SessionIdentity["user"]>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    setError(undefined);
    Promise.all([
      api<UserSummary[]>("/api/users"),
      api<SessionIdentity>("/api/auth/me"),
    ])
      .then(([items, session]) => {
        setUsers(items);
        setMe(session.user);
      })
      .catch((reason) => setError(errorMessage(reason)));
  }, []);
  useEffect(load, [load]);
  async function update(
    user: UserSummary,
    patch: { role?: UserSummary["role"]; active?: boolean },
  ) {
    try {
      await api(`/api/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast({ title: "User updated", tone: "success" });
      load();
    } catch (reason) {
      toast({
        title: "User update failed",
        description: errorMessage(reason),
        tone: "error",
      });
    }
  }
  if (error)
    return (
      <AppShell>
        <LoadError title="Users unavailable" message={error} onRetry={load} />
      </AppShell>
    );
  return (
    <AppShell>
      <PageHeader
        eyebrow="Installation"
        title="Users"
        description="Installation-wide local accounts and platform roles."
        actions={<UserDialog onSaved={load} />}
      />
      {!users ? (
        <Skeleton className="h-72" />
      ) : users.length ? (
        <div className="panel divide-y">
          {users.map((user) => (
            <div
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
              key={user.id}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{user.email}</p>
                <div className="mt-1 flex gap-2">
                  <Badge tone={user.active ? "success" : "neutral"}>
                    {user.active ? "active" : "access removed"}
                  </Badge>
                  {user.mustChangePassword && (
                    <Badge tone="warning">temporary password</Badge>
                  )}
                  {user.id === me?.id && <Badge>you</Badge>}
                </div>
              </div>
              <select
                className="field h-9 w-40 py-1 text-xs"
                value={user.role}
                disabled={!user.active}
                onChange={(e) =>
                  void update(user, { role: e.target.value as UserSummary["role"] })
                }
              >
                {roles.map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
              <Button
                size="sm"
                variant={user.active ? "danger" : "secondary"}
                disabled={user.id === me?.id}
                onClick={() => void update(user, { active: !user.active })}
              >
                {user.active ? "Remove access" : "Restore access"}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Users />}
          title="No users"
          description="Create a local user account."
          action={<UserDialog onSaved={load} />}
        />
      )}
    </AppShell>
  );
}

function UserDialog({ onSaved }: { onSaved: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserSummary["role"]>("developer");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({ email, temporaryPassword: password, role }),
      });
      toast({
        title: "User created",
        description: "They must replace the temporary password at first sign-in.",
        tone: "success",
      });
      setOpen(false);
      setEmail("");
      setPassword("");
      onSaved();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button>
          <UserPlus size={14} />
          New user
        </Button>
      }
      title="Create local user"
      description="Set a temporary password. No email invitation is sent."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <label className="label">Email</label>
          <input
            className="field"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Temporary password</label>
          <input
            className="field"
            type="password"
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Role</label>
          <select
            className="field"
            value={role}
            onChange={(e) => setRole(e.target.value as UserSummary["role"])}
          >
            {roles.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Create user
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
