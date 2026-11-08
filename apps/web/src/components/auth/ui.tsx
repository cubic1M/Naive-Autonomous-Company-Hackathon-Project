// Form pieces from the design's Auth / LoginFromJob / Onboarding artboards, shared by the account screens.
import type { CSSProperties, ReactNode } from "react";

import LastUsedTag from "@/components/LastUsedTag";

export const ACCENT = "#46664F";

export const label: CSSProperties = { display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", fontWeight: 600 };
export const input: CSSProperties = { minHeight: "46px", padding: "0 14px", border: "1px solid #D2CCBF", borderRadius: "8px", background: "#F3F0E9", font: "inherit", fontSize: "15px", fontWeight: 400, color: "#232824" };
export const select: CSSProperties = { ...input, padding: "0 12px" };
export const primary: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", minHeight: "48px", border: "0", borderRadius: "8px", background: ACCENT, color: "#FFFFFF", font: "inherit", fontSize: "15px", fontWeight: 600, textDecoration: "none", cursor: "pointer" };
export const secondary: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", minHeight: "48px", border: "1px solid #D2CCBF", borderRadius: "8px", background: "#FBF9F5", font: "inherit", fontSize: "15px", fontWeight: 600, color: "#232824", textDecoration: "none", cursor: "pointer" };
export const textBtn: CSSProperties = { minHeight: "40px", border: "0", background: "transparent", color: "#3B5A44", font: "inherit", fontSize: "14px", fontWeight: 600, cursor: "pointer", padding: "0" };
export const disabled: CSSProperties = { background: "#8FA394", cursor: "not-allowed" };

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "13px", color: "#5B635C" }}>
      <span style={{ flex: "1", height: "1px", background: "#DCD6CA" }} />
      {children}
      <span style={{ flex: "1", height: "1px", background: "#DCD6CA" }} />
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" style={{ margin: "0", padding: "10px 12px", borderRadius: "8px", background: "#F6E1DE", color: "#A12A22", fontSize: "14px", lineHeight: 1.5 }}>
      {children}
    </p>
  );
}

/** Shown only when the mock API hands back a code or link it would have texted or emailed. */
export function DevHint({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p style={{ margin: "0", padding: "10px 12px", borderRadius: "8px", border: "1px dashed #C5BEB0", background: "#F3F0E9", color: "#4F5751", fontSize: "13px", lineHeight: 1.5 }}>
      <strong style={{ fontFamily: "var(--font-mono)", fontSize: "11px", letterSpacing: "0.1em" }}>MOCK API · </strong>
      {children}
    </p>
  );
}

export function Spinner() {
  return <span className="spinner" style={{ width: "18px", height: "18px" }} aria-hidden="true" />;
}

// Google's "G" mark (their sign-in branding asks for the full-colour logo on a light button).
export const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" style={{ flex: "none" }}>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

/** "Continue with Google": a full-page navigation to the API, which sends the browser to Google and back. */
export function GoogleButton({ next, flow, label = "Continue with Google" }: { next?: string; flow?: "admin"; label?: string }) {
  const q = new URLSearchParams();
  if (next) q.set("next", next);
  if (flow) q.set("flow", flow);
  return (
    <a href={`/api/v1/auth/google/start?${q}`} style={{ ...secondary, background: "#FFFFFF", border: "1px solid #C9C2B4" }}>
      <GoogleIcon />
      {label}
      {flow !== "admin" && <LastUsedTag method="google" />}
    </a>
  );
}
export const PhoneIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" /></svg>
);
export const MailIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#46664F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
);

export const ERRORS: Record<string, string> = {
  bad_credentials: "That email and password don't match. Try again, or use a code instead.",
  no_account: "We couldn't find an Operis account for that. Create one first.",
  email_taken: "An account with that email already exists. Log in instead.",
  phone_taken: "An account with that phone number already exists. Log in instead.",
  weak_password: "Use at least 10 characters for your password.",
  invalid_fields: "Fill in every field.",
  invalid_phone: "Enter a full US phone number, like (415) 555-0123.",
  wrong_code: "That code isn't right. Check the text and try again.",
  code_expired: "That code has expired. Send a new one.",
  too_many_tries: "Too many tries. Send a new code.",
  link_expired: "That link has expired. Request a new one.",
  network: "We couldn't reach Operis. Check your connection and try again.",
  google_failed: "Google sign-in didn't go through. Please try again.",
  google_cancelled: "Google sign-in was cancelled. Try again whenever you're ready.",
  sms_unavailable: "Text codes aren't available yet. Use an email link or your password instead.",
  google_unavailable: "Google sign-in isn't switched on yet. Create an account with your email instead.",
  email_unavailable: "We couldn't send the email just now. Try again in a minute, or use your password.",
  rate_limited: "Too many emails in a short time. Wait a few minutes and try again.",
  login_required: "Log in to continue.",
  wrong_account: "This job link was sent to someone else. Log in with the account it was sent to.",
  identity_unavailable: "ID verification isn't available right now. Try again in a few minutes.",
};
export const errorText = (code: string) => ERRORS[code] ?? "Something went wrong. Please try again.";
