import { outreachByToken, acceptJob } from "@/lib/worker";
import { currentAccount } from "@/lib/accounts";
import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = await outreachByToken(token);
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  const r = await acceptJob(o.outreach_id);
  // Signed in? Link the account to the worker this job went to, so payouts and history follow the account.
  if (r.ok) {
    const a = await currentAccount(req).catch(() => null);
    if (a && a.worker_id !== o.worker_id) {
      const [w] = await sql`select email from workers where id = ${o.worker_id}`;
      if (!a.worker_id || (w?.email && w.email.toLowerCase() === String(a.email).toLowerCase()))
        await sql`update worker_accounts set worker_id = ${o.worker_id}, updated_at = now() where id = ${a.id}`;
    }
  }
  return r.ok
    ? Response.json({ ok: true, state: "accepted" })
    : Response.json({ ok: false, error: r.reason, reasons: "reasons" in r ? r.reasons : undefined }, { status: r.reason === "not_eligible" ? 403 : 409 });
}
