import type { JobState } from "@contracts/states";
import { transitionJob } from "./db";
import { later, wakeForState } from "./naive";

/** Transition + schedule the agent wake-up for the new state. Use this everywhere. */
export async function transition(jobId: string, to: JobState, patch: Record<string, unknown> = {}) {
  const job = await transitionJob(jobId, to, patch);
  later(() => wakeForState(jobId, to));
  if (to === "paid" || to === "refunded" || to === "rejected" || to === "cancelled") {
    const { notifyCustomer } = await import("./callbacks");
    later(() => notifyCustomer(jobId));
  }
  return job;
}
