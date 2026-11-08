// POST: accept the job behind this link. Needs a signed-in worker account (401 login_required otherwise).
// The account is linked to the worker the link was sent to. Only an account that already did jobs as a worker with
// another email is refused (bindAccount); any other account takes the link's worker over.
import { outreachByToken, acceptJob } from "@/lib/worker";
import { bindAccount, currentAccount, loginRequired } from "@/lib/accounts";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (process.env.WORKER_LOGIN === "optional") return accept(req, params, null);
  const a = await currentAccount(req);
  if (!a) return loginRequired();
  return accept(req, params, a);
}

async function accept(_req: Request, params: Promise<{ token: string }>, a: any) {
  const { token } = await params;
  const o = await outreachByToken(token);
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  if (a && !(await bindAccount(a, o.worker_id, true)))
    return Response.json({ ok: false, error: "wrong_account", message: "This job link was sent to someone else. Log in with the account it was sent to." }, { status: 403 });
  const r = await acceptJob(o.outreach_id);
  if (r.ok && a) await bindAccount(a, o.worker_id);
  return r.ok
    ? Response.json({ ok: true, state: "accepted" })
    : Response.json({ ok: false, error: r.reason, reasons: "reasons" in r ? r.reasons : undefined }, { status: r.reason === "not_eligible" ? 403 : 409 });
}
