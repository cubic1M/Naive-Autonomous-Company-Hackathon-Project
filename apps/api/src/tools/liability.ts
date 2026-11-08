// apps/api/src/tools/liability.ts
// Cameron's liability model (docs/specs/2026-11-08-liability-model-design.md): the Compliance agent's tools
// and what happens after a decision. Validation and guardrails live in services/compliance.
import type { ToolContext } from "@contracts/runtime";
import * as compliance from "@services/compliance/index";
import { notifyCustomer } from "@/lib/callbacks";
import { transition } from "@/lib/jobs";
import { later, liabilityDecidedMessage, wake } from "@/lib/naive";

export async function afterDecision(jobId: string, out: { model: string; next: "wake_ceo" | "cancel"; reason: string; changed: boolean }) {
  if (!out.changed) return; // a repeated call never repeats the side effects
  if (out.next === "cancel") {
    await compliance.releaseHold(jobId, `liability policy: ${out.reason}`);
    await transition(jobId, "cancelled"); // also sends the customer's callback
    return;
  }
  await wake("ceo", jobId, "liability_decided", liabilityDecidedMessage(jobId, out.model));
  later(() => notifyCustomer(jobId)); // the customer hears the decision (callbacks carry liability_model)
}

export const LIABILITY_EXTRA_TOOLS = {
  get_liability_context: (args: any, ctx: ToolContext) => compliance.LIABILITY_TOOLS.get_liability_context(args, ctx),
  set_liability: async (args: any, ctx: ToolContext) => {
    const out = await compliance.LIABILITY_TOOLS.set_liability(args, ctx);
    await afterDecision(args.job_id, out);
    return out;
  },
};

export async function requireLiabilityDecision(jobId: string) {
  if (!(await compliance.hasDecision(jobId))) {
    throw new Error("awaiting_liability_decision: the Compliance agent has not recorded this job's liability model yet. Try again after it does.");
  }
}
