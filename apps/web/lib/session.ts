"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { SessionIdentity } from "./types";

let sessionRequest: Promise<SessionIdentity> | undefined;
function requestSession() {
  sessionRequest ??= api<SessionIdentity>("/api/auth/me").catch((error) => {
    sessionRequest = undefined;
    throw error;
  });
  return sessionRequest;
}

export function useCurrentUser() {
  const [user, setUser] = useState<SessionIdentity["user"]>();
  useEffect(() => {
    let active = true;
    requestSession()
      .then((result) => {
        if (active) setUser(result.user);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return user;
}

export function roleAllows(role: string | undefined, allowed: string[]) {
  return role !== undefined && allowed.includes(role);
}
