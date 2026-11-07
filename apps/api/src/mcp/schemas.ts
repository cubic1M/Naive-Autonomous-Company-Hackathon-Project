// Zod input schemas mirroring contracts/tools.ts (keep in sync).
import { z } from "zod";

const location = z.object({ address: z.string(), lat: z.number(), lng: z.number() });
const proof = z.object({
  photos: z.object({ min: z.number().int().min(0), must_show: z.array(z.string()) }).optional(),
  video: z.object({ min_seconds: z.number() }).optional(),
  files: z.object({ kinds: z.array(z.string()) }).optional(),
  geofence_m: z.number().positive(),
  fields: z.array(z.object({ name: z.string(), type: z.enum(["string", "number"]) })).optional(),
});
const jobId = { job_id: z.string().uuid().describe("Job id (uuid) from get_job / the wake-up message") };

export const SCHEMAS = {
  request_human: {
    description:
      "Hire a verified human for a real-world task in San Francisco (photograph/verify a place, pick up & ship, paperwork presence). You pay only when proof passes. Returns job_id, quote and an escrow_url to fund the job.",
    shape: {
      title: z.string().min(3).max(200),
      instructions: z.string().min(3).max(4000),
      location,
      deadline: z.string().describe("ISO 8601, at least 15 minutes from now"),
      budget_usd: z.number().min(20).max(1000),
      certification_required: z.string().nullable().default(null),
      proof,
      callback_url: z.string().url().optional(),
    },
  },
  get_job: { description: "Get a job's status and details; includes the proof package once approved.", shape: jobId },
  cancel_job: { description: "Cancel a job before a worker accepts it.", shape: jobId },
  find_people: {
    description: "Find candidate workers near the job from public, work-related sources. Returns ranked candidate ids.",
    shape: { ...jobId, limit: z.number().int().min(1).max(25).optional() },
  },
  send_blast: {
    description: "Send the job offer (with a personal job link) to the chosen candidates. First to accept gets the job.",
    shape: { ...jobId, candidate_ids: z.array(z.string()).min(1).max(25) },
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
  refund: { description: "Refund the customer for a rejected or expired job.", shape: { ...jobId, reason: z.string().max(500) } },
  ledger: { description: "Money totals: revenue, payouts, fees, costs, jobs paid.", shape: { since: z.string().optional() } },
} as const;
