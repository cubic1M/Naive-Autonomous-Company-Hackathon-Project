// Cameron: real Verifier tools for apps/api's registry (apps/api/src/tools/registry.ts prefers these over
// the mocks). Shapes: contracts/tools.ts; runtime: contracts/runtime.ts. Logic lives in
// services/money-verification (src/proof/*); this file only binds it to the API's ToolContext, whose
// transition() moves the job to approved / escalated / rejected when a decision is recorded.
import type { ServiceModule, ToolContext } from "../../contracts/runtime";
import { createContractTools, depsFromApiContext, type ApiContext } from "../money-verification/src/index";

const tools = (ctx: ToolContext) => createContractTools(depsFromApiContext(ctx as ApiContext));

const verify: ServiceModule = {
  // Runs the automated review (geofence, time window, completeness, media reuse, vision) and returns the evidence.
  check_proof: (input, ctx) => tools(ctx).check_proof(input),
  approve_proof: async (input, ctx) => {
    const out = await tools(ctx).approve_proof(input);
    if (!("error" in out)) return out;
    // contracts/tools.ts knows two error codes; reused media is a fraud signal like an out-of-fence photo.
    const error: "below_threshold" | "outside_geofence" = out.error === "reused_media" ? "outside_geofence" : out.error;
    return { error };
  },
  escalate: (input, ctx) => tools(ctx).escalate(input),
};
export default verify;
