// Worker accounts and their sessions (migration 009). The browser holds an opaque token in the httpOnly
// `operis_session` cookie (operis.live reaches us through its /api rewrite, so the cookie is first-party).
import { createHash, randomBytes } from "node:crypto";
import { sql } from "./db";
import { cookie, cookieValue, type GoogleIdentity } from "./googleAuth";

export const SESSION_COOKIE = "operis_session";
const SESSION_DAYS = 30;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

type Row = { id: string; email: string; name: string; phone: string; google_sub: string | null; profile: Record<string, any>; agreed_terms_at: Date | null };

/** The fields the web app's User type expects (apps/web/src/lib/session.tsx), with defaults. */
export function publicUser(a: Row) {
  const p = a.profile ?? {};
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    phone: a.phone,
    has_password: false,
    google: !!a.google_sub,
    identity: p.identity ?? { status: "unverified", id_type: null },
    skills: p.skills ?? [],
    licenses: p.licenses ?? [],
    profiles: { linkedin: null, portfolio_url: "", other_url: "", ...(p.profiles ?? {}) },
    permissions: { read_profiles: false, search_public: false, learn_choices: false, ...(p.permissions ?? {}) },
    alerts: { sms: true, email: true, call: false, ...(p.alerts ?? {}) },
    min_pay: p.min_pay ?? "",
    radius: p.radius ?? "Up to 25 miles",
    quiet_hours: p.quiet_hours ?? "9 PM – 8 AM",
    agreed_terms_at: a.agreed_terms_at ? new Date(a.agreed_terms_at).toISOString() : null,
    onboarding_step: p.onboarding_step ?? 1,
    onboarding_done: p.onboarding_done ?? false,
  };
}

/** Find the account for this Google identity (by Google id, then by email), or create it. */
export async function upsertGoogleAccount(g: GoogleIdentity): Promise<Row> {
  const [existing] = await sql<Row[]>`select * from worker_accounts where google_sub = ${g.sub} or email = ${g.email} order by (google_sub = ${g.sub}) desc limit 1`;
  if (existing) {
    const [a] = await sql<Row[]>`
      update worker_accounts set google_sub = ${g.sub}, name = case when name = '' then ${g.name} else name end, last_login_at = now()
      where id = ${existing.id} returning *`;
    return a!;
  }
  const id = `wrk_${randomBytes(9).toString("base64url")}`;
  const [a] = await sql<Row[]>`
    insert into worker_accounts (id, email, name, google_sub, last_login_at) values (${id}, ${g.email}, ${g.name}, ${g.sub}, now()) returning *`;
  return a!;
}

/** Start a session; returns the Set-Cookie value. */
export async function startSession(accountId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await sql`insert into worker_sessions (token_hash, account_id, expires_at) values (${hash(token)}, ${accountId}, now() + ${`${SESSION_DAYS} days`}::interval)`;
  return cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400);
}

export async function currentAccount(req: Request): Promise<Row | null> {
  const t = cookieValue(req, SESSION_COOKIE);
  if (!t) return null;
  const [a] = await sql<Row[]>`
    select a.* from worker_sessions s join worker_accounts a on a.id = s.account_id
    where s.token_hash = ${hash(t)} and s.expires_at > now()`;
  return a ?? null;
}

export async function endSession(req: Request): Promise<string> {
  const t = cookieValue(req, SESSION_COOKIE);
  if (t) await sql`delete from worker_sessions where token_hash = ${hash(t)}`;
  return cookie(SESSION_COOKIE, "", 0);
}

const PROFILE_KEYS = ["skills", "profiles", "permissions", "alerts", "min_pay", "radius", "quiet_hours", "onboarding_step", "onboarding_done"] as const;

/** PATCH /v1/me: the onboarding and account-page fields. Unknown keys are ignored. */
export async function updateAccount(a: Row, b: Record<string, any>): Promise<Row> {
  const profile = { ...(a.profile ?? {}) };
  for (const k of PROFILE_KEYS) if (k in b) profile[k] = k === "profiles" ? { ...(profile.profiles ?? {}), ...b.profiles } : b[k];
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 120) : a.name;
  const phone = typeof b.phone === "string" ? b.phone.trim().slice(0, 30) : a.phone;
  const [u] = await sql<Row[]>`
    update worker_accounts set name = ${name}, phone = ${phone}, profile = ${sql.json(profile)},
      agreed_terms_at = case when ${b.agreed_terms === true} and agreed_terms_at is null then now() else agreed_terms_at end
    where id = ${a.id} returning *`;
  return u!;
}
