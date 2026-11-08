"use client";

import Link from "next/link";
import { useState } from "react";

import { postJson } from "@/lib/api";
import { AuthCard } from "./AuthCard";
import { DevHint, FormError, Spinner, errorText, input, label, primary } from "./ui";

export default function ForgotPassword({ email: initial }: { email: string }) {
  const [email, setEmail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await postJson<{ dev_link?: string }>("/v1/auth/password/reset", { email });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.error));
    setDevLink(r.data.dev_link ?? null);
    setSent(true);
  }

  return (
    <AuthCard title="Reset your password" intro={sent ? `If ${email} has an Operis account, we've emailed it a reset link. It expires in 30 minutes.` : "Enter the email on your account and we'll send you a link to choose a new password."}>
      {sent ? (
        <>
          <DevHint>{devLink && <>The email would contain <a href={devLink}>this reset link</a>.</>}</DevHint>
          <Link href="/login" style={primary}>Back to log in</Link>
        </>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <label style={label}>Email
            <input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={input} autoFocus required />
          </label>
          <FormError>{error}</FormError>
          <button type="submit" disabled={busy} style={primary}>{busy && <Spinner />}Send reset link</button>
          <Link href="/login" style={{ fontSize: "14px", fontWeight: 600, color: "#3B5A44", textDecoration: "none" }}>Back to log in</Link>
        </form>
      )}
    </AuthCard>
  );
}
