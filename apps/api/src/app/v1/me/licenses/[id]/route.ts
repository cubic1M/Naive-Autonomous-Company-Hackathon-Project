import { currentAccount, json, loginRequired, userJson } from "@/lib/accounts";
import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await currentAccount(req);
  if (!a) return loginRequired();
  const { id } = await params;
  const profile = { ...(a.profile ?? {}), licenses: (a.profile?.licenses ?? []).filter((l: any) => l.id !== id) };
  const [u] = await sql`update worker_accounts set profile = ${sql.json(profile)}, updated_at = now() where id = ${a.id} returning *`;
  return json({ ok: true, user: userJson(u) });
}
