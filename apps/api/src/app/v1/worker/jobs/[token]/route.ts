// GET: what Dora's job page (/j/[token]) shows. The token in the link is the worker's only credential.
import { outreachByToken } from "@/lib/worker";
import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = await outreachByToken(token);
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  if (["sent", "dry_run", "queued"].includes(o.outreach_status)) await sql`update outreach set status = 'opened' where id = ${o.outreach_id}`;
  const youAreAssigned = o.assigned_worker_id === o.worker_id;
  // Verification tier (Cameron, PR #17): tier 2 jobs need a verified Stripe Identity before proof.
  let verification: { verification_tier: number | null; identity_required: boolean; identity_verified: boolean | null } =
    { verification_tier: null, identity_required: false, identity_verified: null };
  // Cameron's liability model (services/compliance): the licence this worker still has to prove through
  // POST /v1/worker/license before accepting (L1 notary commission, L2 State Bar), and who provides the work.
  let licence_needed: "notary" | "attorney" | null = null;
  try {
    const mv = await import("@services/money-verification/src/index");
    const r: any = await (mv as any).checkEligibility((mv as any).depsFromProcessEnv(), { workerId: o.worker_id, jobId: o.job_id });
    verification = {
      verification_tier: r.tier ?? null,
      identity_required: r.tier === 2,
      identity_verified: !(r.reasons ?? []).some((x: string) => x.startsWith("identity_not_verified")),
    };
    const licence = (r.reasons ?? []).find((x: string) => /^(notary|attorney)_/.test(x));
    licence_needed = licence ? (licence.startsWith("attorney") ? "attorney" : "notary") : null;
  } catch (e) {
    console.warn("[job page] eligibility unavailable:", String(e).slice(0, 160));
  }
  let liability: { liability_model: string | null; liability_reason: string | null } = { liability_model: null, liability_reason: null };
  try {
    const [l] = await sql`select model, reason from job_liability where job_id = ${o.job_id}`;
    if (l) liability = { liability_model: l.model ?? null, liability_reason: l.reason ?? null };
  } catch {
    // job_liability is created by migration 0003; before it runs, the page shows no model.
  }
  return Response.json({
    job: {
      title: o.title, instructions: o.instructions,
      location: { address: o.address, lat: o.lat, lng: o.lng },
      deadline: o.deadline, pay_usd: Number(o.worker_pay_usd),
      certification_required: o.certification_required, proof_requirement: o.proof_requirement,
      ...liability,
    },
    state: youAreAssigned ? o.job_status : o.job_status === "outreach" ? "open" : "unavailable",
    can_accept: o.job_status === "outreach" && ["sent", "dry_run", "opened", "queued"].includes(o.outreach_status),
    can_upload_proof: youAreAssigned && o.job_status === "accepted",
    reply_code: o.short_code,
    ...verification,
    licence_needed,
  });
}
