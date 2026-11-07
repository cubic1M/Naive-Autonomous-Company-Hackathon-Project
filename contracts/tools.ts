// SHARED CONTRACT: every MCP tool, its input/output shape, and who owns it.
// Implement your tool to match exactly. Start with a mock that returns this shape.
// See docs/FLOW.md §7.

import type { JobState } from "./states";

type Owner = "edmond" | "andrew" | "cameron";
type Agent = "customer" | "ceo" | "ops" | "verifier" | "finance" | "sales";

interface ToolSpec<In, Out> {
  in: In;
  out: Out;
}

// ---------- shared shapes ----------
export interface Location { address: string; lat: number; lng: number }

export interface ProofRequirement {
  photos?: { min: number; must_show: string[] };
  video?: { min_seconds: number };
  files?: { kinds: string[] };
  geofence_m: number;
  fields?: { name: string; type: "string" | "number" }[];
}

export interface JobSummary {
  job_id: string;
  status: JobState;
  title: string;
  location: Location;
  deadline: string;
  budget_usd: number;
  worker_id: string | null;
}

// ---------- the tools ----------
export interface Tools {
  // PUBLIC (customer agents): apps/api/src/mcp/public.ts
  request_human: ToolSpec<
    {
      title: string;
      instructions: string;
      location: Location;
      deadline: string; // ISO 8601
      budget_usd: number; // >= 20
      certification_required: string | null;
      proof: ProofRequirement;
      callback_url?: string;
    },
    { job_id: string; status: "requested" | "rejected"; quote_usd: number; escrow_url: string | null; reason?: string }
  >;

  get_job: ToolSpec<
    { job_id: string },
    JobSummary & { proof_package?: { media_urls: string[]; fields: Record<string, unknown>; verifier_score: number } }
  >;

  cancel_job: ToolSpec<{ job_id: string }, { job_id: string; status: "cancelled" }>;

  // INTERNAL: Ops → services/outreach (Andrew)
  find_people: ToolSpec<
    { job_id: string; limit?: number },
    { candidates: { candidate_id: string; name: string | null; channel: "email" | "sms"; source: string; distance_km: number | null; score: number }[] }
  >;

  send_blast: ToolSpec<
    { job_id: string; candidate_ids: string[] },
    { sent: number; skipped_opted_out: number; outreach_ids: string[] }
  >;

  // INTERNAL: Verifier → services/verify (Cameron)
  check_proof: ToolSpec<
    { job_id: string },
    {
      proof_id: string;
      gps_distance_m: number | null;
      timestamp_ok: boolean;
      checklist: { item: string; found: boolean; confidence: number }[];
      overall_score: number; // 0..1
      flags: string[];
    }
  >;

  approve_proof: ToolSpec<
    { job_id: string; proof_id: string; notes: string },
    { job_id: string; status: "approved" } | { error: "below_threshold" | "outside_geofence" }
  >;

  escalate: ToolSpec<
    { job_id: string; proof_id: string; reason: string },
    { job_id: string; status: "escalated" }
  >;

  // INTERNAL: Finance → services/payments (Cameron)
  capture_payment: ToolSpec<{ job_id: string }, { job_id: string; captured_usd: number }>;
  payout: ToolSpec<
    { job_id: string },
    { job_id: string; status: "paid"; worker_pay_usd: number; fee_usd: number } | { error: "needs_bank_setup" | "over_limit" }
  >;
  refund: ToolSpec<{ job_id: string; reason: string }, { job_id: string; status: "refunded"; amount_usd: number }>;
  ledger: ToolSpec<
    { since?: string },
    { revenue_usd: number; payouts_usd: number; fees_usd: number; costs_usd: number; jobs_paid: number }
  >;
}

/** Where each tool lives and who may call it. Edmond mirrors calledBy in agents/agents.json. */
export const TOOL_REGISTRY: Record<keyof Tools, { owner: Owner; folder: string; calledBy: Agent[] }> = {
  request_human:   { owner: "edmond",  folder: "apps/api/src/mcp/public.ts", calledBy: ["customer"] },
  get_job:         { owner: "edmond",  folder: "apps/api/src/mcp/public.ts", calledBy: ["customer", "ceo", "ops", "verifier", "finance"] },
  cancel_job:      { owner: "edmond",  folder: "apps/api/src/mcp/public.ts", calledBy: ["customer"] },
  find_people:     { owner: "andrew",  folder: "services/outreach",          calledBy: ["ops"] },
  send_blast:      { owner: "andrew",  folder: "services/outreach",          calledBy: ["ops"] },
  check_proof:     { owner: "cameron", folder: "services/verify",            calledBy: ["verifier"] },
  approve_proof:   { owner: "cameron", folder: "services/verify",            calledBy: ["verifier"] },
  escalate:        { owner: "cameron", folder: "services/verify",            calledBy: ["verifier"] },
  capture_payment: { owner: "cameron", folder: "services/payments",          calledBy: ["finance"] },
  payout:          { owner: "cameron", folder: "services/payments",          calledBy: ["finance"] },
  refund:          { owner: "cameron", folder: "services/payments",          calledBy: ["finance", "ceo"] },
  ledger:          { owner: "cameron", folder: "services/payments",          calledBy: ["finance", "ceo"] },
};
