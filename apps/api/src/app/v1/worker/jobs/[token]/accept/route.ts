import { outreachByToken, acceptJob } from "@/lib/worker";
export const dynamic = "force-dynamic";
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = await outreachByToken(token);
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  const r = await acceptJob(o.outreach_id);
  return r.ok
    ? Response.json({ ok: true, state: "accepted" })
    : Response.json({ ok: false, error: r.reason, reasons: "reasons" in r ? r.reasons : undefined }, { status: r.reason === "not_eligible" ? 403 : 409 });
}
