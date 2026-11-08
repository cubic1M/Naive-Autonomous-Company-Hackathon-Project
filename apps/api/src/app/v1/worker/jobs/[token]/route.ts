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
  try {
    const mv = await import("@services/money-verification/src/index");
    const r: any = await (mv as any).checkEligibility((mv as any).depsFromProcessEnv(), { workerId: o.worker_id, jobId: o.job_id });
    verification = {
      verification_tier: r.tier ?? null,
      identity_required: r.tier === 2,
      identity_verified: !(r.reasons ?? []).some((x: string) => x.startsWith("identity_not_verified")),
    };
  } catch (e) {
    console.warn("[job page] eligibility unavailable:", String(e).slice(0, 160));
  }
  return Response.json({
    job: {
      title: o.title, instructions: o.instructions,
      location: { address: o.address, lat: o.lat, lng: o.lng },
      deadline: o.deadline, pay_usd: Number(o.worker_pay_usd),
      certification_required: o.certification_required, proof_requirement: o.proof_requirement,
    },
    state: youAreAssigned ? o.job_status : o.job_status === "outreach" ? "open" : "unavailable",
    can_accept: o.job_status === "outreach" && ["sent", "dry_run", "opened", "queued"].includes(o.outreach_status),
    can_upload_proof: youAreAssigned && o.job_status === "accepted",
    reply_code: o.short_code,
    ...verification,
  });
}
