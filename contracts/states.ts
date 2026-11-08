// SHARED CONTRACT. Change only after the team agrees. See docs/FLOW.md §4.

export const JOB_STATES = [
  "requested",
  "held",
  "outreach",
  "accepted",
  "proof_submitted",
  "approved",
  "escalated",
  "paid",
  "rejected",
  "cancelled",
  "expired",
  "refunded",
] as const;

export type JobState = (typeof JOB_STATES)[number];

/** The only allowed transitions. The API rejects anything else. */
export const TRANSITIONS: Record<JobState, JobState[]> = {
  requested: ["held", "rejected", "cancelled"],
  held: ["outreach", "cancelled"],
  outreach: ["accepted", "expired"],
  accepted: ["proof_submitted", "expired"],
  proof_submitted: ["approved", "escalated", "rejected"],
  escalated: ["approved", "rejected"],
  approved: ["paid", "refunded"],
  rejected: ["refunded"],
  expired: ["refunded"],
  paid: ["refunded"], // full refund after capture (partial refunds leave the job paid)
  refunded: [],
  cancelled: [],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Which Naïve agent the API wakes when a job enters a state (via lib/naive.ts wake()). */
export const WAKE_ON_ENTER: Partial<Record<JobState, "ceo" | "ops" | "verifier" | "finance" | "compliance">> = {
  held: "compliance",
  accepted: "ops",
  proof_submitted: "verifier",
  approved: "finance",
};
