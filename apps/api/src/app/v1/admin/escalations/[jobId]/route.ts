// POST { decision: "approve" | "reject", note }: a founder resolves an escalated proof.
// approve → job approved → Finance wakes and pays. reject → job rejected → customer refunded.
import { sql, TransitionError } from "@/lib/db";
import { authAdmin } from "@/lib/auth";
import { transition } from "@/lib/jobs";
import { makeContext } from "@/tools/context";
import { resolveTool } from "@/tools/registry";
import { recordFounderDecision } from "@services/verify/index";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  if (!authAdmin(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { jobId } = await params;
  const { decision, note = "" } = await req.json().catch(() => ({}));
  if (decision !== "approve" && decision !== "reject") return Response.json({ error: "decision must be approve or reject" }, { status: 400 });
  const [p] = await sql`select id from proofs where job_id = ${jobId} order by created_at desc limit 1`;
  if (!p) return Response.json({ error: "no proof for this job" }, { status: 404 });
  const status = decision === "approve" ? "approved" : "rejected";
  // Cameron (PR #30): record the founder's decision in proof_reviews FIRST, the record payout and settle read.
  // Without it a founder-approved job is charged but the worker's payout is refused. It refuses proofs that
  // failed the geofence or reused media (those can never be approved): show the founder why.
  try {
    await recordFounderDecision(jobId, status, note);
  } catch (e: any) {
    const code = e?.code ?? e?.name ?? "error";
    const message = String(e?.message ?? e).slice(0, 300);
    if (code === "invalid_state" || /geofence|reuse|invalid_state/i.test(message))
      return Response.json({ error: "cannot_override", message: `This proof can't be ${status}: ${message}` }, { status: 409 });
    if (code === "not_found" || /not found/i.test(message)) return Response.json({ error: "no proof review for this job", message }, { status: 404 });
    console.error("[escalations] recordFounderDecision failed", e);
    return Response.json({ error: "decision_failed", message }, { status: 502 });
  }
  try {
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
