// Cameron's money/verification tools that aren't in the shared contract yet: proof reviews and chargebacks
// (for the Disputes agent). Validation happens inside his createTools().
import { createTools, depsFromApiContext } from "../../../../services/money-verification/src/index";
import type { ToolContext } from "@contracts/runtime";

const call = (name: "get_proof_review" | "get_dispute" | "submit_dispute_evidence") =>
  (args: unknown, ctx: ToolContext) => (createTools(depsFromApiContext(ctx as any) as any) as any)[name](args);

export const MONEY_EXTRA_TOOLS = {
  get_proof_review: call("get_proof_review"),
  get_dispute: call("get_dispute"),
  submit_dispute_evidence: call("submit_dispute_evidence"),
};
