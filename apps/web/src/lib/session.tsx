"use client";

// Worker accounts (see docs/ACCOUNTS_API.md). The API keeps the session in an httpOnly cookie on our
// own origin (it's reached through the /api/* rewrite), so the browser never handles a token.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { api, postJson } from "./api";

export type IdentityStatus = "unverified" | "processing" | "verified" | "requires_input";

export interface License {
  id: string;
  type: string;
  state: string | null;
  number: string;
  certificate: string | null;
  status: "active" | "not_found" | "pending";
  checked_at: string;
  expires?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  has_password: boolean;
  identity: { status: IdentityStatus; id_type: string | null };
  skills: string[];
  licenses: License[];
  profiles: { linkedin: { name: string; headline: string } | null; portfolio_url: string; other_url: string };
  permissions: { read_profiles: boolean; search_public: boolean; learn_choices: boolean };
  alerts: { sms: boolean; email: boolean; call: boolean };
  min_pay: string;
  radius: string;
  quiet_hours: string;
  agreed_terms_at: string | null;
  onboarding_step: number;
  onboarding_done: boolean;
  sign_in?: {
    google: { connected: boolean; since: string | null };
    password: boolean;
    email_verified: boolean;
    member_since: string | null;
    last: { at: string; method: string | null } | null;
    previous: { at: string; method: string | null } | null;
  };
}

interface Session {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<User | null>;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<Session>({
  user: null,
  loading: true,
  refresh: async () => null,
  setUser: () => {},
  logout: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const r = await api<{ user: User }>("/v1/me", {}, 1);
    const u = r.ok ? r.data.user : null;
    setUser(u);
    setLoading(false);
    return u;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await postJson("/v1/auth/logout");
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, refresh, setUser, logout }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

export const patchMe = (patch: Record<string, unknown>) =>
  api<{ ok: true; user: User }>("/v1/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "•";

export const shortName = (name: string) => {
  const [first, last] = name.split(/\s+/);
  return last ? `${first} ${last[0]}.` : first || "Account";
};
