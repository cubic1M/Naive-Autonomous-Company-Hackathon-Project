import { currentAccount, json, loginRequired, userJson } from "@/lib/accounts";
import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  const a = await currentAccount(req);
  if (!a) return loginRequired();
  const p = a.profile ?? {};
  const profile = { ...p, profiles: { ...(p.profiles ?? { portfolio_url: "", other_url: "" }), linkedin: null } };
  const [u] = await sql`update worker_accounts set profile = ${sql.json(profile)}, updated_at = now() where id = ${a.id} returning *`;
  return json({ ok: true, user: userJson(u) });
}
