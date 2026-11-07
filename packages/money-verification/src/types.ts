/**
 * Domain types shared across the money + verification workstream.
 * Money is ALWAYS integer cents. Timestamps are JS Dates in memory, ISO strings over the wire.
 */

export type JobStatus =
  | 'requested'
  | 'held'
  | 'outreach'
  | 'accepted'
  | 'proof_submitted'
  | 'approved'
  | 'paid'
  | 'escalated'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'refunded';

export type TaskType = 'notarization' | 'inspection' | (string & {});

export interface ProofSchema {
  photos: { min: number; must_show: string[] };
  geofence_m?: number;
  fields?: { name: string; type: 'string' | 'number' | 'boolean' }[];
}

/** Read-only view of teammates' `jobs` table. */
export interface Job {
  id: string;
  task_type: TaskType;
  budget_cents: number;
  worker_pay_cents: number;
  fee_cents: number;
  lat: number;
  lng: number;
  accepted_at: Date | null;
  deadline: Date;
  proof_schema: ProofSchema;
  required_tier: number;
  status: JobStatus;
  worker_id: string | null;
  risk_class: string | null;
}

/** Read-only view of teammates' `workers` table (except stripe_connect_account, which payouts.ts sets). */
export interface Worker {
  id: string;
  name: string;
  phone: string;
  stripe_connect_account: string | null;
  tier: number;
  suspended: boolean;
}

export interface ProofMedia {
  url: string;
  sha256: string;
  mime: string;
}

/** Read-only view of teammates' `proofs` table. */
export interface Proof {
  id: string;
  job_id: string;
  worker_id: string;
  media: ProofMedia[];
  fields: Record<string, unknown>;
  gps_lat: number | null;
  gps_lng: number | null;
  captured_at: Date | null;
}

// ---- Tables owned by this package ----

export type EscrowStatus = 'pending' | 'authorized' | 'captured' | 'released' | 'refunded';

export interface Escrow {
  job_id: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  amount_cents: number;
  status: EscrowStatus;
  authorization_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type LedgerKind =
  | 'escrow_hold'
  | 'escrow_capture'
  | 'escrow_release'
  | 'payout'
  | 'fee'
  | 'refund'
  | 'stripe_cost'
  | 'kyc_cost'
  | 'dispute_loss';

export interface LedgerEntry {
  id: string;
  job_id: string | null;
  kind: LedgerKind;
  amount_cents: number;
  currency: string;
  stripe_ref: string | null;
  idempotency_key: string;
  created_at: Date;
}

export type NewLedgerEntry = Omit<LedgerEntry, 'id' | 'created_at' | 'currency'> & { currency?: string };

export type VerificationKind = 'identity' | 'notary_commission';
export type VerificationStatus = 'pending' | 'verified' | 'failed' | 'needs_review';

export interface WorkerVerification {
  worker_id: string;
  kind: VerificationKind;
  status: VerificationStatus;
  provider_ref: string | null;
  details: Record<string, unknown>;
  verified_at: Date | null;
  expires_at: Date | null;
}

export type ProofDecision = 'approved' | 'escalated' | 'rejected';

export interface ProofCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ProofReview {
  proof_id: string;
  job_id: string;
  confidence: number | null;
  decision: ProofDecision;
  checks: ProofCheck[];
  reviewer: string;
  created_at: Date;
}

export interface NotaryRecord {
  commission_number: string;
  full_name: string;
  name_normalized: string;
  county: string | null;
  city: string | null;
  business_name: string | null;
  commission_expires: Date | null;
  raw: Record<string, unknown>;
  imported_at?: Date;
}
