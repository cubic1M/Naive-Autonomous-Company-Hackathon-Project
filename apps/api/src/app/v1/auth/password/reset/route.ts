// POST {email} → always {ok} (no account probing); emails a reset link (30 min) when the account exists.
import { createLink, json, resetUrl, sendAccountEmail } from "@/lib/accounts";
import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim().toLowerCase();
  const [a] = email ? await sql`select id, email from worker_accounts where lower(email) = ${email}` : [];
  if (a) {
    const [recent] = await sql`select count(*)::int as n from auth_links where account_id = ${a.id} and created_at > now() - interval '15 minutes'`;
    if (recent.n < 5) await sendAccountEmail(a.email, "reset", resetUrl(await createLink(a.id, "reset", null, 30)));
  }
  return json({ ok: true });
}
