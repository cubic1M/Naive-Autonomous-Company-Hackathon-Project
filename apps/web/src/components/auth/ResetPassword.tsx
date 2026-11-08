"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { postJson } from "@/lib/api";
import { useSession, type User } from "@/lib/session";
import { AuthCard } from "./AuthCard";
import { FormError, Spinner, errorText, input, label, primary } from "./ui";
import PasswordInput from "@/components/PasswordInput";

export default function ResetPassword({ token }: { token: string }) {
  const router = useRouter();
  const { setUser } = useSession();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : errorText("link_expired"));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    const r = await postJson<{ user: User }>("/v1/auth/password/reset/confirm", { t: token, password: pw });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.error));
    setUser(r.data.user);
    router.push("/account");
  }

  return (
    <AuthCard title="Choose a new password" intro="Use at least 10 characters. You'll be logged in once it's saved.">
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <label style={label}>New password
          <PasswordInput autoComplete="new-password" minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} style={input} autoFocus required />
        </label>
        <label style={label}>Repeat new password
          <PasswordInput autoComplete="new-password" minLength={10} value={pw2} onChange={(e) => setPw2(e.target.value)} style={input} required />
        </label>
        <FormError>{error}</FormError>
        <button type="submit" disabled={busy || !token} style={primary}>{busy && <Spinner />}Save password and log in</button>
        <Link href="/forgot-password" style={{ fontSize: "14px", fontWeight: 600, color: "#3B5A44", textDecoration: "none" }}>Request a new link</Link>
      </form>
    </AuthCard>
  );
}
