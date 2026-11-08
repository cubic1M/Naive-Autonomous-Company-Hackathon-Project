// SHARED CONTRACT: every MCP tool, its input/output shape, and who owns it.
// Implement your tool to match exactly. Start with a mock that returns this shape.
// See docs/FLOW.md §7.

import type { JobState } from "./states";

type Owner = "edwin" | "andrew" | "cameron";
type Agent = "customer" | "ceo" | "ops" | "verifier" | "finance" | "sales" | "recruiter";

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
  /** Meters from location the proof must be taken within. Optional (default 150); ignored for remote jobs. */
  geofence_m?: number;
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

// ---------- growth shapes (services/growth; docs/specs/2026-11-08-sales-recruiter-design.md) ----------
export type GrowthFamily = "pier70_gigs" | "sf_notaries" | "ca_attorneys" | "developers";
export type GrowthSendStatus = "sent" | "dry_run" | "skipped" | "failed";
export interface GrowthProspect {
  contact_id: string; name: string | null; org: string | null; email_domain: string; notes: string | null; found_via: string; free_first_job: boolean;
}
export interface GrowthDemand { last_7d: number; prior_7d: number; projected_next_7d: number; unfilled_7d: number }
export interface GrowthReport {
  day: string;
  live: { sales: boolean; recruit: boolean };
  sales: { sent_today: number; dry_run_today: number; daily_cap: number; prospects_waiting: number };
  recruiting: { sent_today: number; dry_run_today: number; daily_cap: number; search_spend_today_usd: number; search_cap_usd: number };
  directory: Record<GrowthFamily, { found: number; invited: number; opted_in: number; id_verified: number; licensed: number; target: number; gap: number }>;
  demand: { by_family: Record<GrowthFamily | "other", GrowthDemand>; top_requested: { title: string; count: number }[] };
  promos: { granted: number; max: number; redeemed: number; due: { job_id: string; customer: string; refund_cents: number }[] };
}

// ---------- the tools ----------
export interface Tools {
  // PUBLIC (customer agents): apps/api/src/mcp/public.ts
  request_human: ToolSpec<
    {
      title: string;
      instructions: string;
      /** On-site jobs: where. Remote jobs (remote: true) may pass null. */
      location: Location | null;
      /** Online work (legal, software, design...): no distance limit. Default false. [proposed by Andrew] */
      remote?: boolean;
      deadline: string; // ISO 8601
      budget_usd: number; // >= 20
      certification_required: string | null;
      proof: ProofRequirement;
      callback_url?: string;
      /** Optional: a Stripe PaymentMethod id (pm_...) that funds the job in this call, no payment link. Without it the card saved with setup_payment is used; without either, pay escrow_url. [proposed by Cameron] */
      payment?: { payment_method: string };
    },
    {
      job_id: string;
      status: "requested" | "held" | "rejected";
      quote_usd: number;
      escrow_url: string | null;
      reason?: string;
      /** Set when a passed or saved card could not be charged and escrow_url is the fallback: card_declined, authentication_required, invalid_payment_method, ... */
      fallback_reason?: string;
      next_step?: string;
    }
  >;

  get_job: ToolSpec<
    { job_id: string },
    JobSummary & { proof_package?: { media_urls: string[]; fields: Record<string, unknown>; verifier_score: number } }
  >;

  cancel_job: ToolSpec<{ job_id: string }, { job_id: string; status: "cancelled" }>;

  // INTERNAL: Ops → services/outreach (Andrew)
  find_people: ToolSpec<
    {
      job_id: string;
      limit?: number;
      /** Ops agent's understanding of the job. [proposed by Andrew] */
      hints?: { roles?: string[]; skills?: string[]; credential?: string | null; remote?: boolean };
    },
    {
      candidates: {
        candidate_id: string;
        name: string | null;
        /** *_manual = drafted DM a teammate sends from a real Operis account (platforms ban automated DMs). */
        channel: "email" | "sms" | "linkedin_manual" | "x_manual" | "reddit_manual" | "instagram_manual";
        source: string;
        distance_km: number | null;
        score: number;
      }[];
    }
  >;

  send_blast: ToolSpec<
    { job_id: string; candidate_ids: string[] },
    { sent: number; skipped_opted_out: number; queued_manual: number; outreach_ids: string[] }
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
  refund: ToolSpec<
    { job_id: string; reason: string; amount_cents?: number; request_id?: string },
    { job_id: string; status: "refunded"; amount_usd: number; refunded_total_usd?: number; partial?: true; released_hold?: true }
  >;
  /** Over the $150 cap: the CEO agent runs these with approved_by (Cameron, PR #11). */
  refund_large: ToolSpec<
    { job_id: string; reason: string; amount_cents?: number; request_id: string; approved_by: string; approval_note?: string },
    { job_id: string; status: "refunded"; amount_usd: number; refunded_total_usd?: number; partial?: true; released_hold?: true }
  >;
  release_payout_large: ToolSpec<
    { job_id: string; approved_by: string; approval_note?: string },
    { job_id: string; status: "paid"; worker_pay_usd: number; fee_usd: number }
  >;
  ledger: ToolSpec<
    { since?: string },
    { revenue_usd: number; payouts_usd: number; fees_usd: number; costs_usd: number; jobs_paid: number }
  >;

  // GROWTH (Sales, Recruiter, CEO): services/growth
  list_prospects: ToolSpec<{ limit?: number }, { prospects: GrowthProspect[]; used_today: number; daily_cap: number }>;
  send_marketing: ToolSpec<
    { contact_id: string; personal_line?: string; offer_free_first_job?: boolean },
    { contact_id: string; status: GrowthSendStatus; reason?: string; promo?: { granted: boolean; cap_usd?: number; expires_at?: string; reason?: string } }
  >;
  suppress_contact: ToolSpec<{ email: string; reason: string }, { suppressed: true; matched_contacts: number; matched_workers: number }>;
  recruit_search: ToolSpec<
    { family: GrowthFamily; limit?: number },
    {
      family: GrowthFamily; found: number; new: number; spend_usd: number; spend_today_usd: number; daily_cap_usd: number; error?: string;
      candidates: { person_id: string; name: string | null; headline: string | null; source: string; score: number; distance_km: number | null }[];
    }
  >;
  recruit_invite: ToolSpec<
    { family: GrowthFamily; person_ids: string[] },
    { sent: number; dry_run: number; skipped: number; failed: number; used_today: number; daily_cap: number; results: { person_id: string; status: GrowthSendStatus; reason?: string }[] }
  >;
  growth_report: ToolSpec<Record<string, never>, GrowthReport>;
  redeem_promo: ToolSpec<
    { job_id: string },
    { eligible: true; refund: { job_id: string; amount_cents: number; request_id: string; reason: string } } | { eligible: false; reason: string }
  >;
}

/** Where each tool lives and who may call it. Edwin mirrors calledBy in agents/agents.json. */
export const TOOL_REGISTRY: Record<keyof Tools, { owner: Owner; folder: string; calledBy: Agent[] }> = {
  request_human:   { owner: "edwin",  folder: "apps/api/src/mcp/public.ts", calledBy: ["customer"] },
  get_job:         { owner: "edwin",  folder: "apps/api/src/mcp/public.ts", calledBy: ["customer", "ceo", "ops", "verifier", "finance"] },
  cancel_job:      { owner: "edwin",  folder: "apps/api/src/mcp/public.ts", calledBy: ["customer"] },
  find_people:     { owner: "andrew",  folder: "services/outreach",          calledBy: ["ops"] },
  send_blast:      { owner: "andrew",  folder: "services/outreach",          calledBy: ["ops"] },
  check_proof:     { owner: "cameron", folder: "services/verify",            calledBy: ["verifier"] },
  approve_proof:   { owner: "cameron", folder: "services/verify",            calledBy: ["verifier"] },
  escalate:        { owner: "cameron", folder: "services/verify",            calledBy: ["verifier"] },
  capture_payment: { owner: "cameron", folder: "services/payments",          calledBy: ["finance"] },
  payout:          { owner: "cameron", folder: "services/payments",          calledBy: ["finance"] },
  refund:          { owner: "cameron", folder: "services/payments",          calledBy: ["finance", "ceo"] },
  refund_large:    { owner: "cameron", folder: "services/payments",          calledBy: ["ceo"] },
  release_payout_large: { owner: "cameron", folder: "services/payments",     calledBy: ["ceo"] },
  ledger:          { owner: "cameron", folder: "services/payments",          calledBy: ["finance", "ceo"] },
  list_prospects:   { owner: "cameron", folder: "services/growth", calledBy: ["sales"] },
  send_marketing:   { owner: "cameron", folder: "services/growth", calledBy: ["sales"] },
  suppress_contact: { owner: "cameron", folder: "services/growth", calledBy: ["sales"] },
  recruit_search:   { owner: "cameron", folder: "services/growth", calledBy: ["recruiter"] },
  recruit_invite:   { owner: "cameron", folder: "services/growth", calledBy: ["recruiter"] },
  growth_report:    { owner: "cameron", folder: "services/growth", calledBy: ["sales", "recruiter", "ceo"] },
  redeem_promo:     { owner: "cameron", folder: "services/growth", calledBy: ["ceo"] },
};
