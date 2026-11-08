// POST {t, password} → sets the new password, signs in → {ok, user}. 400 link_expired / weak_password.
import { hashPassword, json, signedIn, useLink, weakPassword } from "@/lib/accounts";
import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (weakPassword(b.password)) return json({ ok: false, error: "weak_password" }, 400);
  const l = b.t ? await useLink(String(b.t), "reset") : null;
  if (!l) return json({ ok: false, error: "link_expired" }, 400);
  const [a] = await sql`update worker_accounts set password_hash = ${hashPassword(b.password)}, email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
                        where id = ${l.account_id} returning *`;
  await sql`delete from worker_sessions where account_id = ${a.id}`; // sign out other devices
  return signedIn(a);
}
