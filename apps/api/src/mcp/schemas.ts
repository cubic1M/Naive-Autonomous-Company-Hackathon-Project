// Zod input schemas mirroring contracts/tools.ts (keep in sync).
import { z } from "zod";

const location = z.object({ address: z.string(), lat: z.number(), lng: z.number() });
const proof = z.object({
  photos: z.object({ min: z.number().int().min(0), must_show: z.array(z.string()) }).optional(),
  video: z.object({ min_seconds: z.number() }).optional(),
  files: z.object({ kinds: z.array(z.string()) }).optional(),
  geofence_m: z.number().positive().optional().describe("meters from location the proof must be taken within; default 150; ignored for remote jobs"),
  fields: z.array(z.object({ name: z.string(), type: z.enum(["string", "number"]) })).optional().describe("answers the worker must fill in, e.g. [{\"name\":\"keypad_lights_up\",\"type\":\"string\"}]; returned in proof_package.fields"),
});
const jobId = { job_id: z.string().uuid().describe("Job id (uuid) from get_job / the wake-up message") };

export const SCHEMAS = {
  request_human: {
    description:
      "Hire a verified human for a real-world task in San Francisco (photograph/verify a place, pick up & ship, paperwork presence). You pay only when proof passes. Returns job_id and quote; status held means it is funded already (from payment.payment_method or your saved card), otherwise escrow_url is the link to fund it.",
    shape: {
      title: z.string().min(3).max(200),
      instructions: z.string().min(3).max(4000),
      location: location.nullable().default(null).describe("Where (on-site jobs). null for remote work."),
      remote: z.boolean().optional().describe("true for online work (no location needed)"),
      deadline: z.string().describe("ISO 8601, at least 15 minutes from now"),
      budget_usd: z.number().min(20).max(1000),
      certification_required: z.string().nullable().default(null),
      proof,
      callback_url: z.string().url().optional(),
      payment: z
        .object({ payment_method: z.string().regex(/^pm_/, "a Stripe PaymentMethod id, pm_...") })
        .optional()
        .describe("Fund the job now with a Stripe PaymentMethod id (pm_...; in test mode pm_card_visa), no link. Without it your card saved with setup_payment is used; without either, escrow_url must be paid."),
    },
  },
  get_job: { description: "Get a job's status and details; includes the proof package once approved.", shape: jobId },
  cancel_job: { description: "Cancel a job before a worker accepts it.", shape: jobId },
  setup_payment: {
    description:
      "Get a one-time Stripe link where your human owner saves a card (nothing is charged then). Once saved, request_human funds every job from it in the call: status held, escrow_url null. Call again to replace the card.",
    shape: {},
  },
  find_people: {
    description: "Find candidate workers near the job from public, work-related sources. Returns ranked candidate ids.",
    shape: {
      ...jobId,
      limit: z.number().int().min(1).max(50).optional(),
      hints: z.object({ roles: z.array(z.string()).optional(), skills: z.array(z.string()).optional(), credential: z.string().nullable().optional(), remote: z.boolean().optional() }).optional(),
    },
  },
  send_blast: {
    description: "Send the job offer (with a personal job link) to the chosen candidates. First to accept gets the job.",
    shape: { ...jobId, candidate_ids: z.array(z.string()).min(1).max(50) },
  },
  check_proof: {
    description: "Score the latest proof for a job: GPS distance, timestamp, checklist items with confidence, overall score and flags. Evidence only; you decide.",
    shape: jobId,
  },
  approve_proof: {
    description: "Approve a proof. Refused (below_threshold / outside_geofence) unless the evidence meets the limits.",
    shape: { ...jobId, proof_id: z.string(), notes: z.string().max(1000) },
  },
  escalate: { description: "Send a proof to a human reviewer instead of approving it.", shape: { ...jobId, proof_id: z.string(), reason: z.string().max(1000) } },
  capture_payment: { description: "Capture the customer's held payment for an approved job.", shape: jobId },
  payout: { description: "Pay the worker for an approved, captured job.", shape: jobId },
  refund: {
    description: "Refund the customer (full, or partial with amount_cents). Capped at $150 cumulative per job; above that it returns requires_approval and the CEO uses refund_large.",
    shape: { ...jobId, reason: z.string().max(500), amount_cents: z.number().int().positive().optional(), request_id: z.string().max(200).optional() },
  },
  refund_large: {
    description: "CEO only: refund above the $150 cap. Ask a founder (ask_operator) first only for legal threats, safety issues, or above $1,000.",
    shape: { ...jobId, reason: z.string().max(500), amount_cents: z.number().int().positive().optional(), request_id: z.string().max(200), approved_by: z.string().max(100), approval_note: z.string().max(1000).optional() },
  },
  release_payout_large: {
    description: "CEO only: pay a worker above the $150 cap after Finance reports over_limit.",
    shape: { ...jobId, approved_by: z.string().max(100), approval_note: z.string().max(1000).optional() },
  },
  ledger: { description: "Money totals: revenue, payouts, fees, costs, jobs paid.", shape: { since: z.string().optional() } },
  get_proof_review: {
    description: "Latest automated/manual review of a job's proof (tier, checks, flags, decision). Pass job_id or proof_id.",
    shape: { job_id: z.string().uuid().optional(), proof_id: z.string().uuid().optional() },
  },
  get_dispute: { description: "Evidence bundle for a Stripe chargeback: dispute, job, proof review, ledger lines.", shape: { dispute_id: z.string().min(1) } },
  get_liability_context: {
    description: "Compliance only: the job's intake tags, pricing, the models you may choose (allowed_models), any recorded decision, and the full liability policy text.",
    shape: jobId,
  },
  set_liability: {
    description: "Compliance only: record the job's liability model (operis, connector or refuse) with the policy rule id and a one-line reason the customer can read. Final once recorded.",
    shape: {
      ...jobId,
      model: z.enum(["operis", "connector", "refuse"]),
      rule_id: z.string().min(1).max(4).describe("Policy rule id from get_liability_context, e.g. D, L1, L2, U, R"),
      reason: z.string().min(1).max(500),
    },
  },
  submit_dispute_evidence: {
    description: "Draft (default) or submit chargeback evidence to Stripe. submit: true sends it and can't be undone.",
    shape: { dispute_id: z.string().min(1), evidence: z.record(z.any()), submit: z.boolean().optional() },
  },
} as const;
