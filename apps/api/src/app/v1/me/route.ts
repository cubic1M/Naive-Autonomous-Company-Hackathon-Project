// GET → {user}; PATCH any of name, skills, profiles, permissions, alerts, min_pay, radius, quiet_hours,
// onboarding_step, onboarding_done, agreed_terms:true → {ok, user}.
import { currentAccount, json, loginRequired, userJson } from "@/lib/accounts";
import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";

/** Identity status comes from Cameron's worker_verifications (Stripe Identity webhook) when it exists. */
async function syncIdentity(a: any) {
  if (!a.worker_id || a.identity_status === "verified") return a;
  try {
    const [v] = await sql`select status from worker_verifications where worker_id = ${a.worker_id} and kind = 'identity'
                          order by created_at desc limit 1`;
    const map: Record<string, string> = { verified: "verified", pending: "processing", needs_review: "requires_input", failed: "requires_input" };
    const s = v ? map[v.status] : null;
    if (s && s !== a.identity_status) {
      const [u] = await sql`update worker_accounts set identity_status = ${s}, updated_at = now() where id = ${a.id} returning *`;
      return u;
    }
  } catch {
    // worker_verifications comes from money-verification's migration; without it, keep what we have.
  }
  return a;
}

export async function GET(req: Request) {
  const a = await currentAccount(req);
  if (!a) return loginRequired();
  return json({ ok: true, user: userJson(await syncIdentity(a)) });
}

const PROFILE_KEYS = ["skills", "profiles", "permissions", "alerts", "min_pay", "radius", "quiet_hours", "onboarding_step", "onboarding_done"] as const;

export async function PATCH(req: Request) {
  const a = await currentAccount(req);
  if (!a) return loginRequired();
  const b = await req.json().catch(() => ({}));
  const profile = { ...(a.profile ?? {}) };
  for (const k of PROFILE_KEYS) if (k in b) profile[k] = b[k];
  if (JSON.stringify(profile).length > 20000) return json({ ok: false, error: "too_large" }, 400);
  const name = typeof b.name === "string" && b.name.trim().length >= 2 ? b.name.trim().slice(0, 120) : a.name;
  const [u] = await sql`update worker_accounts set name = ${name}, profile = ${sql.json(profile)},
                          agreed_terms_at = ${b.agreed_terms === true ? sql`coalesce(agreed_terms_at, now())` : sql`agreed_terms_at`},
                          updated_at = now()
                        where id = ${a.id} returning *`;
  if (name !== a.name && a.worker_id) await sql`update workers set name = ${name} where id = ${a.worker_id}`;
  return json({ ok: true, user: userJson(u) });
}
