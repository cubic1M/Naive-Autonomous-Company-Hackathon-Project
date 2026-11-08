// POST { decision: "approve" | "reject", note }: a founder resolves an escalated proof.
// approve → job approved → Finance wakes and pays. reject → job rejected → customer refunded.
import { sql, TransitionError } from "@/lib/db";
import { authAdmin } from "@/lib/auth";
import { transition } from "@/lib/jobs";
import { makeContext } from "@/tools/context";
import { resolveTool } from "@/tools/registry";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  if (!authAdmin(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { jobId } = await params;
  const { decision, note = "" } = await req.json().catch(() => ({}));
  if (decision !== "approve" && decision !== "reject") return Response.json({ error: "decision must be approve or reject" }, { status: 400 });
  const [p] = await sql`select id from proofs where job_id = ${jobId} order by created_at desc limit 1`;
  if (!p) return Response.json({ error: "no proof for this job" }, { status: 404 });
  try {
    const status = decision === "approve" ? "approved" : "rejected";
    await sql`update proofs set status = ${status}, reviewed_by = 'founder', verifier_notes = coalesce(verifier_notes, '') || ${note ? ` | founder: ${note}` : " | founder decision"} where id = ${p.id}`;
    await transition(jobId, status);
    if (decision === "reject") {
      const { impl } = resolveTool("refund");
      await impl({ job_id: jobId, reason: `proof rejected by founder${note ? `: ${note}` : ""}` }, makeContext());
    }
    return Response.json({ ok: true, job_id: jobId, status: decision === "approve" ? "approved" : "refunded" });
  } catch (e) {
    if (e instanceof TransitionError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
