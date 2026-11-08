// Worker accounts (apps/web/docs/ACCOUNTS_API.md): passwords (scrypt), httpOnly session cookies, login links,
// password resets, and the `user` shape the web app renders. The browser reaches these routes through the
// web app's /api/* rewrite, so the cookie is first-party on operis.live.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db";
import { baseUrl } from "@/lib/env";
import { HttpMonid } from "../../../../services/outreach/src/index";
import { MonidEmailSender } from "../../../../services/outreach/src/senders";

export const COOKIE = "operis_session";
const SESSION_DAYS = 30;

// ---------- passwords ----------
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(pw, salt, 32).toString("hex")}`;
}
export function checkPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [, salt, hex] = stored.split("$");
  if (!salt || !hex) return false;
  const want = Buffer.from(hex, "hex");
  const got = scryptSync(pw, salt, want.length);
  return timingSafeEqual(want, got);
}
export const weakPassword = (pw: unknown) => typeof pw !== "string" || pw.length < 10;

// ---------- tokens ----------
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

// ---------- sessions ----------
function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}
const secure = () => !/localhost|127\.0\.0\.1/.test(baseUrl());

export async function startSession(accountId: string, remember = true): Promise<string> {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400e3);
  await sql`insert into worker_sessions (token_hash, account_id, expires_at) values (${sha(token)}, ${accountId}, ${expires})`;
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", ...(secure() ? ["Secure"] : []), ...(remember ? [`Max-Age=${SESSION_DAYS * 86400}`] : [])];
  return `${COOKIE}=${token}; ${attrs.join("; ")}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure() ? "; Secure" : ""}`;

export async function endSession(req: Request) {
  const t = readCookie(req, COOKIE);
  if (t) await sql`delete from worker_sessions where token_hash = ${sha(t)}`;
}

export type Account = Record<string, any>;
export async function currentAccount(req: Request): Promise<Account | null> {
  const t = readCookie(req, COOKIE);
  if (!t) return null;
  const [a] = await sql`select a.* from worker_sessions s join worker_accounts a on a.id = s.account_id
                        where s.token_hash = ${sha(t)} and s.expires_at > now()`;
  return a ?? null;
}

export const json = (body: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...(cookie ? { "Set-Cookie": cookie } : {}) } });
export const loginRequired = () => json({ ok: false, error: "login_required" }, 401);

/** Respond with the user and a fresh session cookie. */
export async function signedIn(a: Account, remember = true, status = 200) {
  return json({ ok: true, user: userJson(a) }, status, await startSession(a.id, remember));
}

// ---------- the user the web app renders ----------
export function userJson(a: Account) {
  const p = a.profile ?? {};
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    phone: a.phone ?? "",
    has_password: Boolean(a.password_hash),
    identity: { status: a.identity_status ?? "unverified", id_type: a.id_type ?? null },
    skills: p.skills ?? [],
    licenses: p.licenses ?? [],
    profiles: p.profiles ?? { linkedin: null, portfolio_url: "", other_url: "" },
    permissions: p.permissions ?? { read_profiles: false, search_public: false, learn_choices: false },
    alerts: p.alerts ?? { sms: false, email: true, call: false },
    min_pay: p.min_pay ?? "",
    radius: p.radius ?? "",
    quiet_hours: p.quiet_hours ?? "",
    agreed_terms_at: a.agreed_terms_at ?? null,
    onboarding_step: p.onboarding_step ?? 0,
    onboarding_done: p.onboarding_done ?? false,
  };
}

/** The workers row this account's jobs go to: an existing one with the same email (outreach found them), else a new one. */
export async function workerFor(name: string, email: string, phone: string | null): Promise<string> {
  const [w] = await sql`select w.id from workers w left join outreach o on o.worker_id = w.id
                        where lower(w.email) = lower(${email}) group by w.id order by count(o.id) desc, min(w.created_at) limit 1`;
  if (w) return w.id;
  const [n] = await sql`insert into workers (name, email, phone, source) values (${name}, ${email}, ${phone}, 'signup') returning id`;
  return n.id;
}

// ---------- login links and resets ----------
export async function createLink(accountId: string, kind: "login" | "reset", next: string | null, minutes: number) {
  const token = newToken();
  await sql`insert into auth_links (token_hash, kind, account_id, next, expires_at)
            values (${sha(token)}, ${kind}, ${accountId}, ${next}, ${new Date(Date.now() + minutes * 60e3)})`;
  return token;
}
/** Use a link once. Returns the account id and next path, or null if unknown/expired/used. */
export async function useLink(token: string, kind: "login" | "reset") {
  const [l] = await sql`update auth_links set used_at = now()
                        where token_hash = ${sha(token)} and kind = ${kind} and used_at is null and expires_at > now()
                        returning account_id, next`;
  return l ?? null;
}
/** Only same-site paths, so a link can't bounce someone to another site. */
export const safeNext = (n: unknown) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/");

// ---------- email (AgentMail through Monid, same sender as job offers) ----------
const FONT = "'Avenir Next',Avenir,'Nunito Sans','Helvetica Neue',Helvetica,Arial,sans-serif";
function emailHtml(heading: string, body: string, button: string, url: string, foot: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;background:#fbfaf6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
<tr><td style="font-family:${FONT};font-size:20px;font-weight:600;letter-spacing:-0.02em;color:#2f3a33;padding-bottom:20px">operis.</td></tr>
<tr><td style="background:#f0eee8;border-radius:16px;padding:28px">
<div style="font-family:${FONT};font-size:24px;font-weight:600;letter-spacing:-0.02em;color:#2f3a33;margin-bottom:10px">${heading}</div>
<div style="font-family:${FONT};font-size:15px;line-height:1.55;color:#4a514c;margin-bottom:22px">${body}</div>
<a href="${url}" style="display:inline-block;background:#46664f;color:#f4f1e8;text-decoration:none;font-family:${FONT};font-size:15px;font-weight:600;padding:13px 26px;border-radius:12px">${button}</a>
</td></tr>
<tr><td style="font-family:${FONT};font-size:12px;line-height:1.6;color:#8a8f8a;padding-top:18px">${foot}<br>Operis · San Francisco, CA · operis.live</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendAccountEmail(to: string, kind: "login" | "reset", url: string) {
  const subject = kind === "login" ? "Your Operis login link" : "Reset your Operis password";
  const text = kind === "login"
    ? `Log in to Operis: ${url}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`
    : `Reset your Operis password: ${url}\n\nThe link works once and expires in 30 minutes. If you didn't ask for it, ignore this email.`;
  const html = kind === "login"
    ? emailHtml("Log in to Operis", "Tap the button to log in. The link works once and expires in 15 minutes.", "Log in", url, "Didn't ask for this? You can ignore this email.")
    : emailHtml("Reset your password", "Tap the button to choose a new password. The link works once and expires in 30 minutes.", "Choose a new password", url, "Didn't ask for this? Your password hasn't changed; you can ignore this email.");
  const inbox = process.env.AGENTMAIL_INBOX;
  const key = process.env.MONID_API_KEY;
  if (!inbox || !key) {
    console.warn(`[accounts] email not configured; ${kind} link for ${to} not sent`);
    return { ok: false as const, error: "email_unavailable" };
  }
  const sender = new MonidEmailSender(new HttpMonid(key, process.env.MONID_BASE_URL), inbox);
  const r = await sender.send(to, subject, text, html);
  if (!r.ok) console.error(`[accounts] ${kind} email to ${to} failed:`, r.error);
  return r;
}

export const linkUrl = (token: string) => `${baseUrl()}/api/v1/auth/link/verify?t=${encodeURIComponent(token)}`;
export const resetUrl = (token: string) => `${baseUrl()}/reset-password?t=${encodeURIComponent(token)}`;

// ---------- Continue with Google (PR #50) ----------
/** Find the account for a verified Google identity: by google_sub, else by email (then link it), else create one. */
export async function upsertGoogleAccount(g: { sub: string; email: string; name: string }): Promise<Account> {
  const [bySub] = await sql`update worker_accounts set last_login_at = now() where google_sub = ${g.sub} returning *`;
  if (bySub) return bySub;
  // Google verified the email, so linking an existing email account to it is safe.
  const [byEmail] = await sql`update worker_accounts set google_sub = ${g.sub}, last_login_at = now(),
                                email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
                              where lower(email) = ${g.email.toLowerCase()} returning *`;
  if (byEmail) return byEmail;
  const name = g.name.trim() || g.email.split("@")[0]!;
  const workerId = await workerFor(name, g.email, null);
  const [a] = await sql`insert into worker_accounts (worker_id, name, email, google_sub, email_verified_at, last_login_at)
                        values (${workerId}, ${name}, ${g.email.toLowerCase()}, ${g.sub}, now(), now()) returning *`;
  return a;
}
