// GET: what Dora's job page (/j/[token]) shows. The token in the link is the worker's only credential.
import { outreachByToken } from "@/lib/worker";
import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = await outreachByToken(token);
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  if (o.outreach_status === "sent") await sql`update outreach set status = 'opened' where id = ${o.outreach_id}`;
  const youAreAssigned = o.assigned_worker_id === o.worker_id;
  return Response.json({
    job: {
      title: o.title, instructions: o.instructions,
      location: { address: o.address, lat: o.lat, lng: o.lng },
      deadline: o.deadline, pay_usd: Number(o.worker_pay_usd),
      certification_required: o.certification_required, proof_requirement: o.proof_requirement,
    },
    state: youAreAssigned ? o.job_status : o.job_status === "outreach" ? "open" : "unavailable",
    can_accept: o.job_status === "outreach" && ["sent", "opened"].includes(o.outreach_status),
    can_upload_proof: youAreAssigned && o.job_status === "accepted",
    reply_code: o.short_code,
  });
}
