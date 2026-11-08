// apps/api/src/tools/liability.ts
// Cameron's liability model (docs/specs/2026-11-08-liability-model-design.md): the Compliance agent's tools
// and what happens after a decision. Validation and guardrails live in services/compliance.
import type { ToolContext } from "@contracts/runtime";
import * as compliance from "@services/compliance/index";
import { notifyCustomer } from "@/lib/callbacks";
import { TransitionError } from "@/lib/db";
import { transition } from "@/lib/jobs";
import { later, liabilityDecidedMessage, wake } from "@/lib/naive";

/**
 * What follows a recorded decision, driven by the job's state rather than by whether this call wrote the decision,
 * so a retry (the agent's, or the sweep's re-drive) finishes what a failure left undone. Every step is idempotent.
 * - refuse: move held -> cancelled first (atomic; it refuses a job that has moved past held), then release the
 *   card hold (releaseEscrow returns early once released). A job already cancelled goes straight to the release.
 * - operis / connector: wake the CEO once per job (wake_events (job, liability_decided)); the customer's callback
 *   goes out with the wake that is new, not with a duplicate.
 */
export async function afterDecision(jobId: string, out: { model: string; next: "wake_ceo" | "cancel"; reason: string }) {
  if (out.next === "cancel") {
    try {
      await transition(jobId, "cancelled"); // also sends the customer's callback
    } catch (e) {
      if (!(e instanceof TransitionError && e.current === "cancelled")) throw e; // never release the hold of a job past held
    }
    await compliance.releaseHold(jobId, `liability policy: ${out.reason}`);
    return;
  }
  const woke = await wake("ceo", jobId, "liability_decided", liabilityDecidedMessage(jobId, out.model));
  if (!("skipped" in woke && woke.skipped === "duplicate")) later(() => notifyCustomer(jobId)); // callbacks carry liability_model
}

/** No Compliance agent configured (NAIVE_AGENT_COMPLIANCE unset): the intake tags decide at held and the CEO is woken now. */
export async function decideWithoutAgent(jobId: string) {
  const out = await compliance.autoDecision(jobId);
  await afterDecision(jobId, out);
  return out;
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
