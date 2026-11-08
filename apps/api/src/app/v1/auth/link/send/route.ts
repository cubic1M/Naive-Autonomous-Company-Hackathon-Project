// POST {email, next} → emails a one-time login link (15 min). 404 no_account.
import { createLink, json, linkUrl, safeNext, sendAccountEmail } from "@/lib/accounts";
import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim().toLowerCase();
  const [a] = email ? await sql`select id, email from worker_accounts where lower(email) = ${email}` : [];
  if (!a) return json({ ok: false, error: "no_account" }, 404);
  const [recent] = await sql`select count(*)::int as n from auth_links where account_id = ${a.id} and created_at > now() - interval '15 minutes'`;
  if (recent.n >= 5) return json({ ok: false, error: "rate_limited" }, 429);
  const t = await createLink(a.id, "login", safeNext(b.next), 15);
  const r = await sendAccountEmail(a.email, "login", linkUrl(t));
  if (!r.ok) return json({ ok: false, error: "email_unavailable" }, 503);
  return json({ ok: true });
}
