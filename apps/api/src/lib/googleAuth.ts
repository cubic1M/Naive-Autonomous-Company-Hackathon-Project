// "Continue with Google" for worker accounts and founder backoffice sign-in.
// One Google OAuth client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Its authorized redirect URI must be
// {PUBLIC_BASE_URL}/api/v1/auth/google/callback (override with GOOGLE_REDIRECT_URI).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { baseUrl, optional } from "./env";

export type GoogleFlow = "worker" | "admin";
export const STATE_COOKIE = "operis_g_state";
const STATE_TTL_MS = 10 * 60e3;

export const googleConfigured = () => !!(optional("GOOGLE_CLIENT_ID") && optional("GOOGLE_CLIENT_SECRET"));
export const redirectUri = () => optional("GOOGLE_REDIRECT_URI") ?? `${baseUrl()}/api/v1/auth/google/callback`;

const sign = (s: string) => createHmac("sha256", optional("GOOGLE_CLIENT_SECRET") ?? "").update(s).digest("base64url");

/** Only same-site paths, so the callback can't be turned into an open redirect. */
export function safeNext(n: string | null | undefined, fallback = "/jobs"): string {
  return n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n.slice(0, 500) : fallback;
}

/** Build the Google consent URL and the nonce to bind (via cookie) to this browser. */
export function startUrl(flow: GoogleFlow, next: string): { url: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ f: flow, n: next, r: nonce, x: Date.now() + STATE_TTL_MS })).toString("base64url");
  const q = new URLSearchParams({
    client_id: optional("GOOGLE_CLIENT_ID")!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state: `${payload}.${sign(payload)}`,
    prompt: "select_account",
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, nonce };
}

/** Verify the state Google echoed back against the cookie nonce. Null if forged, expired or from another browser. */
export function readState(state: string | null, cookieNonce: string | null): { flow: GoogleFlow; next: string } | null {
  if (!state || !cookieNonce) return null;
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof s.x !== "number" || Date.now() > s.x || s.r !== cookieNonce) return null;
    return { flow: s.f === "admin" ? "admin" : "worker", next: safeNext(s.n) };
  } catch {
    return null;
  }
}

export interface GoogleIdentity { sub: string; email: string; name: string }

/** Exchange the code for tokens and read the verified identity from the ID token. */
export async function exchangeCode(code: string): Promise<GoogleIdentity> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: optional("GOOGLE_CLIENT_ID")!,
      client_secret: optional("GOOGLE_CLIENT_SECRET")!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const j = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!r.ok || !j.id_token) throw new Error(`google token exchange failed: ${j.error ?? r.status}`);
  // The ID token came straight from Google over TLS, so its claims can be read without re-checking the
  // signature (Google's guidance for the authorization-code flow). Still check who it was issued for.
  const claims = JSON.parse(Buffer.from(j.id_token.split(".")[1] ?? "", "base64url").toString());
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) throw new Error("google: bad issuer");
  if (claims.aud !== optional("GOOGLE_CLIENT_ID")) throw new Error("google: token for another client");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) throw new Error("google: token expired");
  if (!claims.email || claims.email_verified !== true) throw new Error("google: email not verified");
  return { sub: String(claims.sub), email: String(claims.email).toLowerCase(), name: String(claims.name ?? "") };
}

export function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export const cookie = (name: string, value: string, maxAgeSec: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;

/** 302 to a same-site path, with any cookies to set. */
export function redirect(location: string, cookies: string[] = []): Response {
  const h = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers: h });
}
