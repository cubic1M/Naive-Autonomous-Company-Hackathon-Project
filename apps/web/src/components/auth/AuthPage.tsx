"use client";

// Port of the design's "Create account / Log in" artboard (Auth.dc.html).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { postJson } from "@/lib/api";
import { useSession, type User } from "@/lib/session";
import { LogoPill } from "@/components/SiteHeader";
import LoginMethods from "./LoginMethods";
import { Divider, FormError, GoogleIcon, Spinner, errorText, input, label, primary, secondary } from "./ui";
import PasswordInput from "@/components/PasswordInput";

export function AuthFooter() {
  return (
    <footer style={{ background: "radial-gradient(90% 120% at 85% 100%, #2C3D31 0%, #1A241D 45%, #141B16 100%)", color: "#C3CBC2" }}>
      <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "20px 24px", display: "flex", flexWrap: "wrap", gap: "12px 24px", justifyContent: "space-between", fontSize: "13px" }}>
        <span style={{ color: "#8E958C" }}>© 2026 Operis</span>
        <nav aria-label="Footer" style={{ display: "flex", flexWrap: "wrap", gap: "8px 22px" }}>
          <Link href="/terms" style={{ textDecoration: "none", color: "inherit" }}>Worker Terms</Link>
          <Link href="/privacy" style={{ textDecoration: "none", color: "inherit" }}>Privacy</Link>
          <Link href="/help" style={{ textDecoration: "none", color: "inherit" }}>Help</Link>
        </nav>
      </div>
    </footer>
  );
}

export function SimpleHeader({ action }: { action: React.ReactNode }) {
  return (
    <header style={{ position: "relative", zIndex: 5, background: "#ECE8DF" }}>
      <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
        <LogoPill />
        {action}
      </div>
    </header>
  );
}

export const headerLink = { display: "inline-flex", alignItems: "center", minHeight: "44px", padding: "0 16px", borderRadius: "8px", background: "#FFFFFF", border: "1px solid #DCD6CA", color: "#1F2A22", fontSize: "14px", fontWeight: 500, textDecoration: "none" } as const;

const STEPS = [
  ["Create your account", "Email, phone and password."],
  ["Verify your identity and skills", "Government ID, plus any licenses or certificates."],
  ["Get matched", "We text or email you when a fitting job is posted. Accept or pass."],
];

export default function AuthPage({ mode: initialMode, next, error: initialError }: { mode: "signup" | "login"; next: string; error?: string | null }) {
  const router = useRouter();
  const { user, setUser } = useSession();
  const [mode, setMode] = useState(initialMode);
  const [f, setF] = useState({ name: "", email: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ? errorText(initialError) : null);
  const signup = mode === "signup";

  // Keep the URL in step with the tab, so Back and refresh land on the same form.
  useEffect(() => {
    const qs = next !== "/jobs" ? `?next=${encodeURIComponent(next)}` : "";
    window.history.replaceState(null, "", `/${mode}${qs}`);
  }, [mode, next]);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await postJson<{ user: User }>("/v1/auth/signup", f);
    setBusy(false);
    if (!r.ok) return setError(errorText(r.error));
    setUser(r.data.user);
    router.push(`/onboarding?next=${encodeURIComponent(next)}`);
  }

  const base = { minHeight: "42px", border: "0", borderRadius: "7px", font: "inherit", fontSize: "15px", fontWeight: 600, cursor: "pointer" } as const;
  const on = { ...base, background: "#FBF9F5", color: "#1F2A22", boxShadow: "0 1px 3px rgba(60,50,30,0.12)" };
  const off = { ...base, background: "transparent", color: "#4F5751" };

  return (
    <div style={{ overflow: "hidden", background: "#ECE8DF" }}>
      <div style={{ color: "#232824", background: "#ECE8DF", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <SimpleHeader action={<Link href="/jobs" style={headerLink}>Back to requests</Link>} />

        <main style={{ flex: "1", width: "100%", maxWidth: "1180px", margin: "0 auto", boxSizing: "border-box", padding: "40px 24px 56px", display: "flex", flexWrap: "wrap", gap: "28px", alignItems: "stretch" }}>
          <section aria-label="About Operis for workers" style={{ flex: "1 1 380px", background: "radial-gradient(120% 110% at 88% 0%, #43594A 0%, #26342B 42%, #151D17 100%)", color: "#F3EEE4", borderRadius: "14px", padding: "36px", display: "flex", flexDirection: "column", gap: "22px" }}>
            <h1 style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "32px", lineHeight: 1.15, letterSpacing: "-0.035em", color: "#F3EEE4" }}>Work for AI companies, <span style={{ color: "#8E958C" }}>on your terms</span></h1>
            <p style={{ margin: "0", fontSize: "16px", lineHeight: 1.6, color: "#DCE6D8" }}>Create one account and Operis will reach out when an autonomous company posts a job that fits your skills and location.</p>
            <ol style={{ listStyle: "none", margin: "6px 0 0", padding: "0", display: "flex", flexDirection: "column", gap: "16px" }}>
              {STEPS.map(([t, d], i) => (
                <li key={t} style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                  <span style={{ flex: "none", width: "30px", height: "30px", borderRadius: "999px", background: "#A9C0A2", color: "#1E2A22", fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}><strong style={{ color: "#F3F0E9", fontSize: "15px" }}>{t}</strong><span style={{ fontSize: "14px", color: "#DCE6D8", lineHeight: 1.5 }}>{d}</span></span>
                </li>
              ))}
            </ol>
            <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: "10px", padding: "14px 16px", borderRadius: "12px", background: "rgba(251, 248, 242, 0.12)", fontSize: "14px", color: "#F3EEE4" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
              Every job is paid into escrow before you accept it.
            </div>
          </section>

          <section aria-label="Account" style={{ flex: "1 1 420px", background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: "14px", padding: "32px", display: "flex", flexDirection: "column", gap: "20px" }}>
            {user ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <h2 style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "24px", letterSpacing: "-0.03em" }}>You&apos;re logged in as {user.name || user.email}</h2>
                <Link href={next} style={primary}>Continue</Link>
                <Link href="/account" style={secondary}>My account</Link>
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "4px", padding: "4px", background: "#E5E1D7", borderRadius: "12px" }}>
                  <button type="button" onClick={() => { setMode("signup"); setError(null); }} aria-pressed={signup} style={signup ? on : off}>Create account</button>
                  <button type="button" onClick={() => { setMode("login"); setError(null); }} aria-pressed={!signup} style={signup ? off : on}>Log in</button>
                </div>

                <a href={`/api/v1/auth/google/start?next=${encodeURIComponent(next)}`} style={secondary}>
                  <GoogleIcon />
                  Continue with Google
                </a>
                <Divider>{signup ? "or with email" : "or"}</Divider>

                {signup ? (
                  <form aria-label="Create account" onSubmit={createAccount} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <label style={label}>Full legal name
                      <input type="text" autoComplete="name" placeholder="As it appears on your ID" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={input} required />
                    </label>
                    <label style={label}>Email
                      <input type="email" autoComplete="email" placeholder="you@example.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} style={input} required />
                    </label>
                    <label style={label}>Mobile phone
                      <input type="tel" autoComplete="tel" placeholder="(415) 555-0123" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} style={input} required />
                      <span style={{ fontSize: "13px", fontWeight: 400, color: "#5B635C" }}>Used for job alerts. You choose how we contact you in the next step.</span>
                    </label>
                    <label style={label}>Password
                      <PasswordInput autoComplete="new-password" placeholder="At least 10 characters" minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} style={input} required />
                    </label>
                    <FormError>{error}</FormError>
                    <button type="submit" disabled={busy} style={{ ...primary, marginTop: "4px" }}>{busy && <Spinner />}Create account and continue</button>
                    <p style={{ margin: "0", fontSize: "13px", lineHeight: 1.5, color: "#5B635C", textAlign: "center" }}>Next, you&apos;ll verify your ID and review our <Link href="/terms" style={{ color: "#3B5A44" }}>Worker Terms</Link> before anything is shared.</p>
                  </form>
                ) : (
                  <>
                    <FormError>{error}</FormError>
                    <LoginMethods next={next} initialMode="password" />
                    <p style={{ margin: "0", fontSize: "13px", lineHeight: 1.5, color: "#5B635C", textAlign: "center" }}>Opened a job link from a text or email? You&apos;ll go straight back to it after logging in.</p>
                  </>
                )}
              </>
            )}
          </section>
        </main>

        <AuthFooter />
      </div>
    </div>
  );
}
