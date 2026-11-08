// Cameron: real Verifier tools for apps/api's registry (apps/api/src/tools/registry.ts prefers these over
// the mocks). Shapes: contracts/tools.ts; runtime: contracts/runtime.ts. Logic lives in
// services/money-verification (src/proof/*); this file only binds it to the API's ToolContext, whose
// transition() moves the job to approved / escalated / rejected when a decision is recorded.
import type { ServiceModule, ToolContext } from "../../contracts/runtime";
import {
  createContractTools,
  depsFromApiContext,
  depsFromProcessEnv,
  startIdentityVerification,
  type ApiContext,
  type VerificationStatus,
} from "../money-verification/src/index";

const tools = (ctx: ToolContext) => createContractTools(depsFromApiContext(ctx as ApiContext));

const verify: ServiceModule = {
  // Runs the automated review (profile/tier, geofence, time window, completeness, media reuse, identity on tier 2,
  // vision) and returns the evidence, including `decision`, `tier` and `profile`.
  check_proof: (input, ctx) => tools(ctx).check_proof(input),
  approve_proof: async (input, ctx) => {
    const out = await tools(ctx).approve_proof(input);
    if (!("error" in out)) return out;
    // contracts/tools.ts knows two error codes. Reused media is a fraud signal like an out-of-fence photo; a
    // tier-2 worker without a verified identity means the evidence is not sufficient yet (check_proof's
    // `identity` flag says so), so the agent escalates.
    const error: "below_threshold" | "outside_geofence" =
      out.error === "reused_media" ? "outside_geofence" : out.error === "identity_unverified" ? "below_threshold" : out.error;
    return { error };
  },
  escalate: (input, ctx) => tools(ctx).escalate(input),
};
export default verify;

/**
 * Named export, read with `import * as verify from "@services/verify/index"` like createPayoutLink after PR #15.
 * Called by POST /v1/worker/identity (Dora's job page, before proof upload on a tier-2 job): a hosted Stripe
 * Identity link for the worker (government ID plus a matching selfie), or { url: null, status: 'verified' }
 * when the identity is already on file. Needs DATABASE_URL, STRIPE_SECRET_KEY and PUBLIC_BASE_URL (the
 * return URL is <PUBLIC_BASE_URL>/join/<workerId>/identity/done). The outcome arrives by webhook
 * (identity.verification_session.verified / requires_input / canceled, handled by stripeWebhook).
 */
export async function createIdentityLink(workerId: string): Promise<{ url: string | null; status: VerificationStatus }> {
  const { url, status } = await startIdentityVerification(depsFromProcessEnv(), workerId);
  return { url, status };
}
