// How someone signed in, in words, plus the small bits of memory that make sign-in feel familiar:
// the method they used last (for a "Last used" tag) and a one-time "you just signed in" note.
export type SignInMethod = "google" | "password" | "email_link" | "password_reset" | "signup" | "code";

export const METHOD_LABEL: Record<string, string> = {
  google: "Google",
  password: "email and password",
  email_link: "an email link",
  password_reset: "a password reset",
  signup: "a new account",
  code: "a text code",
};

/** "today at 10:31 PM", "yesterday at 9:02 AM", "Nov 7 at 4:15 PM", "Nov 7, 2025" (older than this year). */
export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => x.toDateString();
  const yest = new Date(now.getTime() - 86400e3);
  if (day(d) === day(now)) return `today at ${time}`;
  if (day(d) === day(yest)) return `yesterday at ${time}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${time}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const LAST = "operis_last_signin_method";
const JUST = "operis_just_signed_in";

/** The method this browser used last time ("google" | "password" | "email_link"), for the "Last used" tag. */
export function lastMethod(): string | null {
  try { return localStorage.getItem(LAST); } catch { return null; }
}
export function rememberMethod(m: string) {
  const keep = m === "signup" || m === "password_reset" ? "password" : m;
  try { localStorage.setItem(LAST, keep); } catch {}
}

/** Called right after a sign-in done in the page (password, signup, code); SignInNotice shows it once. */
export function markJustSignedIn(method: SignInMethod, welcome: "new" | "back" = "back") {
  rememberMethod(method);
  try { sessionStorage.setItem(JUST, JSON.stringify({ method, welcome })); } catch {}
}
export function takeJustSignedIn(): { method: string; welcome: string } | null {
  try {
    const v = sessionStorage.getItem(JUST);
    if (!v) return null;
    sessionStorage.removeItem(JUST);
    return JSON.parse(v);
  } catch { return null; }
}
