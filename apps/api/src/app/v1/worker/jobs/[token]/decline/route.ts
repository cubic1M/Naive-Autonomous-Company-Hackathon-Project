// POST: decline the job behind this link. Needs a signed-in worker account like accept (401 login_required).
import { outreachByToken, declineJob } from "@/lib/worker";
import { bindAccount, currentAccount, loginRequired } from "@/lib/accounts";
export const dynamic = "force-dynamic";
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const a = process.env.WORKER_LOGIN === "optional" ? null : await currentAccount(req);
  if (!a && process.env.WORKER_LOGIN !== "optional") return loginRequired();
  const { token } = await params;
  const o = await outreachByToken(token);
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  if (a && !(await bindAccount(a, o.worker_id, true)))
    return Response.json({ ok: false, error: "wrong_account", message: "This job link was sent to someone else." }, { status: 403 });
  await declineJob(o.outreach_id);
  if (a) await bindAccount(a, o.worker_id);
  return Response.json({ ok: true });
}
