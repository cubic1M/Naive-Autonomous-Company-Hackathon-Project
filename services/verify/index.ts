// Cameron: real Verifier tools for apps/api's registry (apps/api/src/tools/registry.ts prefers these over
// the mocks). Shapes: contracts/tools.ts; runtime: contracts/runtime.ts. Logic lives in
// services/money-verification (src/proof/*); this file only binds it to the API's ToolContext, whose
// transition() moves the job to approved / escalated / rejected when a decision is recorded.
import type { ServiceModule, ToolContext } from "../../contracts/runtime";
import {
  createContractTools,
  depsFromApiContext,
  depsFromProcessEnv,
  recordFounderDecision as recordFounderDecisionOnProof,
  startIdentityVerification,
  type ApiContext,
  type VerificationStatus,
} from "../money-verification/src/index";

const tools = (ctx: ToolContext) => createContractTools(depsFromApiContext(ctx as ApiContext));

const verify: ServiceModule = {
  // Runs the automated review (profile/tier, geofence, time window, completeness, media reuse, identity on every job,
  // vision) and returns the evidence, including `decision`, `tier` and `profile`.
  check_proof: (input, ctx) => tools(ctx).check_proof(input),
  approve_proof: async (input, ctx) => {
    const out = await tools(ctx).approve_proof(input);
    if (!("error" in out)) return out;
    // contracts/tools.ts knows two error codes. Reused media is a fraud signal like an out-of-fence photo; a
    // worker without a verified identity (IDENTITY_GATE=enforce), too few photos or missing fields
    // (incomplete) and a capture time outside the window mean the evidence is not sufficient, so the agent escalates.
    const error: "below_threshold" | "outside_geofence" = out.error === "reused_media" || out.error === "outside_geofence" ? "outside_geofence" : "below_threshold";
    return { error };
  },
  // contracts/tools.ts types escalate's result as { job_id, status: "escalated" } only. A proof that is already approved
  // (the job is being paid) is not re-opened: the agent gets { job_id, status: "approved", error: "already_approved",
  // message } as a readable result instead of a thrown tool error. The cast only narrows the declared type.
  escalate: (input, ctx) => tools(ctx).escalate(input) as Promise<{ job_id: string; status: "escalated" }>,
};
export default verify;

/**
 * Named export, read with `import * as verify from "@services/verify/index"` like createPayoutLink after PR #15.
 * Called by POST /v1/worker/identity (Dora's job page, before a worker accepts any job): a hosted Stripe
 * Identity link for the worker (government ID plus a matching selfie), or { url: null, status: 'verified' }
 * when the identity is already on file. Needs DATABASE_URL, STRIPE_SECRET_KEY and PUBLIC_BASE_URL (the
 * return URL is <PUBLIC_BASE_URL>/join/<workerId>/identity/done). The outcome arrives by webhook
 * (identity.verification_session.verified / requires_input / canceled, handled by stripeWebhook).
 */
export async function createIdentityLink(workerId: string): Promise<{ url: string | null; status: VerificationStatus }> {
  const { url, status } = await startIdentityVerification(depsFromProcessEnv(), workerId);
  return { url, status };
}

/**
 * Named export for the founder console (POST /v1/admin/escalations/[jobId]): records the founder's decision on the job's
 * latest proof in proof_reviews (reviewer 'founder'), the record payout and settle read, so a founder-approved job can
 * be paid. Fires no hooks: call it first, then the route's own `update proofs` and transition(). Approving lifts the
 * confidence threshold and the identity gate (recorded as waived); it throws InvalidStateError (code 'invalid_state')
 * on a geofence or reused-media failure, and so does rejecting a proof that is already approved. Needs DATABASE_URL.
 */
export async function recordFounderDecision(
  jobId: string,
  decision: "approved" | "rejected",
  note = "",
): Promise<{ proof_id: string; decision: string }> {
  const review = await recordFounderDecisionOnProof(depsFromProcessEnv(), { jobId, decision, note });
  return { proof_id: review.proof_id, decision: review.decision };
}
