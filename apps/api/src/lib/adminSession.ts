// Founder sessions for the backoffice: email on ADMIN_EMAILS + shared password (stored only as a scrypt
// hash: ADMIN_PASSWORD_SALT + ADMIN_PASSWORD_HASH). Tokens are HMAC-signed with ADMIN_KEY, 12 h.
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { optional, list } from "./env";

const TTL_MS = 12 * 3600e3;

export function allowedAdminEmails(): string[] {
  return list("ADMIN_EMAILS").map((e) => e.toLowerCase());
}

export function passwordOk(password: string): boolean {
  const salt = optional("ADMIN_PASSWORD_SALT"), hash = optional("ADMIN_PASSWORD_HASH");
  if (!salt || !hash || !password) return false;
  const got = scryptSync(password, salt, 32);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

const sign = (payload: string) => createHmac("sha256", optional("ADMIN_KEY") ?? "").update(payload).digest("base64url");

export function issueSession(email: string): { token: string; expires_at: string } {
  const exp = Date.now() + TTL_MS;
  const payload = Buffer.from(JSON.stringify({ e: email, x: exp })).toString("base64url");
  return { token: `ops_${payload}.${sign(payload)}`, expires_at: new Date(exp).toISOString() };
}

/** Returns the founder's email for a valid, unexpired session token, else null. */
export function verifySession(token: string | null | undefined): string | null {
  if (!token?.startsWith("ops_") || !optional("ADMIN_KEY")) return null;
  const [payload, sig] = token.slice(4).split(".");
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof x !== "number" || Date.now() > x) return null;
    return allowedAdminEmails().includes(String(e).toLowerCase()) ? String(e) : null; // removing an email revokes it
  } catch { return null; }
}
