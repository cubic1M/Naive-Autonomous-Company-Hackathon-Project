import { outreachByToken, declineJob } from "@/lib/worker";
export const dynamic = "force-dynamic";
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = await outreachByToken(token);
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  await declineJob(o.outreach_id);
  return Response.json({ ok: true });
}
