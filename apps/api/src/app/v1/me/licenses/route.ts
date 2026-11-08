// POST {type, state, number, certificate} → adds a licence as `pending` (checked against the state registry
// by the Verifier/Compliance flow, e.g. verify_notary for CA notaries) → {ok, license, user}.
import { randomUUID } from "node:crypto";
import { currentAccount, json, loginRequired, userJson } from "@/lib/accounts";
import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await currentAccount(req);
  if (!a) return loginRequired();
  const b = await req.json().catch(() => ({}));
  const type = String(b.type ?? "").trim().slice(0, 80);
  const number = String(b.number ?? "").trim().slice(0, 60);
  if (!type || !number) return json({ ok: false, error: "invalid_fields" }, 400);
  const license = {
    id: randomUUID(), type, state: b.state ? String(b.state).slice(0, 40) : null, number,
    certificate: b.certificate ? String(b.certificate).slice(0, 500) : null,
    status: "pending" as const, checked_at: new Date().toISOString(),
  };
  const profile = { ...(a.profile ?? {}), licenses: [...(a.profile?.licenses ?? []), license].slice(-20) };
  const [u] = await sql`update worker_accounts set profile = ${sql.json(profile)}, updated_at = now() where id = ${a.id} returning *`;
  return json({ ok: true, license, user: userJson(u) });
}
