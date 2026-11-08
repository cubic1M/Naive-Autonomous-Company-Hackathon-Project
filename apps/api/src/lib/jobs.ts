import type { JobState } from "@contracts/states";
import * as payments from "@services/payments/index";
import { transitionJob } from "./db";
import { later, wakeForState } from "./naive";

/**
 * Release the customer's card hold of a cancelled job (Cameron's services/payments releaseCancelledHold): every move to
 * cancelled runs it. A failure is logged, never thrown, so it cannot block the cancel; the sweep retries it.
 */
export async function releaseHoldAfterCancel(jobId: string, reason = "job cancelled") {
  try {
    const r = await payments.releaseCancelledHold(jobId, reason);
    if (r.released) console.log(`[hold] job ${jobId}: card hold released (${reason})`);
    return r;
  } catch (e) {
    console.error(`[hold] job ${jobId}: releasing the card hold failed; the sweep retries it`, e);
    return null;
  }
}

/** Transition + schedule the agent wake-up for the new state. Use this everywhere. */
export async function transition(jobId: string, to: JobState, patch: Record<string, unknown> = {}) {
  const job = await transitionJob(jobId, to, patch);
  later(() => wakeForState(jobId, to));
  // Every cancel (the customer's cancel_job, the sweep's overdue cancel, a liability refusal) releases the card hold.
  if (to === "cancelled") later(() => releaseHoldAfterCancel(jobId));
  if (to === "paid" || to === "refunded" || to === "rejected" || to === "cancelled") {
    const { notifyCustomer } = await import("./callbacks");
    later(() => notifyCustomer(jobId));
  }
  return job;
}
