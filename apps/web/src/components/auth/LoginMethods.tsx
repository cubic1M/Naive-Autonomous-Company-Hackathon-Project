"use client";

// Text a code, email a login link, or email + password: the three methods from the design's
// "Log in from a recommended job" artboard. Google lives on the main Auth page.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { postJson } from "@/lib/api";
import { useSession, type User } from "@/lib/session";
import { DevHint, Divider, FormError, GoogleButton, MailIcon, PhoneIcon, Spinner, errorText, input, label, primary, secondary, textBtn } from "./ui";
import PasswordInput from "@/components/PasswordInput";
import LastUsedTag from "@/components/LastUsedTag";
import { markJustSignedIn, type SignInMethod } from "@/lib/signin";

export type Mode = "start" | "phone" | "code" | "email" | "link_sent" | "password";

export const introFor = (mode: Mode, phoneHint: string | null, fromJob: boolean) =>
  mode === "code"
    ? `We texted a 6-digit code to ${phoneHint ?? "your phone"}. It expires in 10 minutes.`
    : mode === "password"
      ? "Log in with the email and password on your Operis account."
      : mode === "link_sent"
        ? "Check your email for a login link. It expires in 15 minutes."
        : mode === "email"
          ? "We'll email you a link that logs you straight in."
        : fromJob
          ? "Log in with Google, or get a code on the phone this job was sent to."
          : "Log in with Google, get a code by text, a link by email, or use your password.";

export default function LoginMethods({
  next,
  jobToken,
  phoneHint: initialHint,
  initialMode = "start",
  onModeChange,
  showGoogle = true,
}: {
  next: string;
  jobToken?: string;
  phoneHint?: string | null;
  initialMode?: Mode;
  onModeChange?: (m: Mode, phoneHint: string | null) => void;
  /** AuthPage shows its own Google button above the tabs. */
  showGoogle?: boolean;
}) {
  const router = useRouter();
  const { setUser } = useSession();
  const [mode, setModeState] = useState<Mode>(initialMode);
  const [phone, setPhone] = useState("");
  const [sentHint, setPhoneHint] = useState<string | null>(null);
  const phoneHint = sentHint ?? initialHint ?? null; // the job's hint arrives after first render
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dev, setDev] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  const setMode = (m: Mode, hint = phoneHint) => {
    setModeState(m);
    setError(null);
    onModeChange?.(m, hint);
  };

  const done = (u: User, method: SignInMethod) => {
    setUser(u);
    markJustSignedIn(method);
    router.push(next);
  };

  async function sendCode() {
    if (!jobToken && !phone.trim()) return setMode("phone");
    setBusy("code");
    setError(null);
    const r = await postJson<{ phone_hint: string; dev_code?: string }>("/v1/auth/code/send", jobToken ? { job_token: jobToken } : { phone });
    setBusy(null);
    if (!r.ok) return setError(errorText(r.error));
    setPhoneHint(r.data.phone_hint);
    setDev(r.data.dev_code ? `Your code is ${r.data.dev_code} (a real SMS would carry it).` : null);
    setCode("");
    setMode("code", r.data.phone_hint);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy("verify");
    const r = await postJson<{ user: User }>("/v1/auth/code/verify", jobToken ? { job_token: jobToken, code } : { phone, code });
    setBusy(null);
    if (!r.ok) return setError(errorText(r.error));
    done(r.data.user, "code");
  }

  async function sendLink(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy("link");
    setError(null);
    const r = await postJson<{ dev_link?: string }>("/v1/auth/link/send", { email, next });
    setBusy(null);
    if (!r.ok) return setError(errorText(r.error));
    setDevLink(r.data.dev_link ?? null);
    setMode("link_sent");
  }

  async function passwordLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy("password");
    setError(null);
    const r = await postJson<{ user: User }>("/v1/auth/login", { email, password, remember });
    setBusy(null);
    if (!r.ok) return setError(errorText(r.error));
    done(r.data.user, "password");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {mode === "start" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {showGoogle && (
            <>
              <GoogleButton next={next} label="Log in with Google" />
              <Divider>or</Divider>
            </>
          )}
          <button type="button" onClick={sendCode} disabled={busy !== null} style={{ ...primary, minHeight: "50px" }}>
            {busy === "code" ? <Spinner /> : <PhoneIcon />}
            {jobToken && phoneHint ? `Text a code to ${phoneHint}` : "Text me a code"}
          </button>
          <button type="button" onClick={() => setMode("email")} style={secondary}>
            <MailIcon />
            Email me a login link
            <LastUsedTag method="email_link" />
          </button>
          <Divider>or</Divider>
          <button type="button" onClick={() => setMode("password")} style={{ ...textBtn, minHeight: "44px", fontSize: "15px" }}>Log in with email and password<LastUsedTag method="password" /></button>
        </div>
      )}

      {mode === "phone" && (
        <form onSubmit={(e) => { e.preventDefault(); sendCode(); }} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <label style={label}>Mobile phone
            <input type="tel" autoComplete="tel" placeholder="(415) 555-0123" value={phone} onChange={(e) => setPhone(e.target.value)} style={input} autoFocus required />
          </label>
          <button type="submit" disabled={busy !== null} style={primary}>{busy === "code" ? <Spinner /> : <PhoneIcon />}Text me a code</button>
          <button type="button" onClick={() => setMode("start")} style={{ ...textBtn, alignSelf: "flex-start" }}>Use another method</button>
        </form>
      )}

      {mode === "code" && (
        <form onSubmit={verifyCode} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <DevHint>{dev}</DevHint>
          <label style={label}>6-digit code
            <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus style={{ ...input, minHeight: "56px", padding: "0 16px", fontSize: "24px", fontWeight: 600, letterSpacing: "0.4em" }} />
          </label>
          <button type="submit" disabled={busy !== null || code.length !== 6} style={{ ...primary, minHeight: "50px", ...(code.length !== 6 ? { background: "#8FA394", cursor: "not-allowed" } : {}) }}>
            {busy === "verify" && <Spinner />}{jobToken ? "Verify and view job" : "Verify and log in"}
          </button>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "14px" }}>
            <button type="button" onClick={() => setMode("start")} style={textBtn}>Use another method</button>
            <button type="button" onClick={sendCode} disabled={busy !== null} style={textBtn}>{busy === "code" ? "Sending…" : "Resend code"}</button>
          </div>
        </form>
      )}

      {mode === "email" && (
        <form onSubmit={sendLink} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <label style={label}>Email
            <input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={input} autoFocus required />
          </label>
          <button type="submit" disabled={busy !== null} style={primary}>{busy === "link" ? <Spinner /> : <MailIcon />}Email me a login link</button>
          <button type="button" onClick={() => setMode("start")} style={{ ...textBtn, alignSelf: "flex-start" }}>Use another method</button>
        </form>
      )}

      {mode === "link_sent" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <p style={{ margin: "0", fontSize: "15px", lineHeight: 1.55 }}>We sent a link to <strong>{email}</strong>. Open it on this device to log in.</p>
          <DevHint>{devLink && <>The email would contain <a href={devLink}>this login link</a>.</>}</DevHint>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
            <button type="button" onClick={() => setMode("email")} style={textBtn}>Use a different email</button>
            <button type="button" onClick={() => sendLink()} disabled={busy !== null} style={textBtn}>{busy === "link" ? "Sending…" : "Send again"}</button>
          </div>
        </div>
      )}

      {mode === "password" && (
        <form aria-label="Log in with password" onSubmit={passwordLogin} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <label style={label}>Email
            <input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={input} required />
          </label>
          <label style={label}>Password
            <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={input} required />
          </label>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", fontSize: "14px", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "40px", cursor: "pointer" }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: "17px", height: "17px", accentColor: "#46664F" }} />Keep me logged in
            </label>
            <Link href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`} style={{ fontWeight: 600, textDecoration: "none", color: "#3B5A44" }}>Forgot password?</Link>
          </div>
          <button type="submit" disabled={busy !== null} style={{ ...primary, minHeight: "50px" }}>{busy === "password" && <Spinner />}{jobToken ? "Log in and view job" : "Log in"}</button>
          <button type="button" onClick={() => setMode("start")} style={{ ...textBtn, alignSelf: "flex-start" }}>Text me a code instead</button>
        </form>
      )}

      <FormError>{error}</FormError>
    </div>
  );
}
