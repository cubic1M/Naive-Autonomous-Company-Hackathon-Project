-- Operis money + verification tables. Idempotent; run by hand (psql "$DATABASE_URL" -f this_file).
-- Does NOT touch teammates' tables (jobs, workers, proofs).

create table if not exists escrows (
  job_id uuid primary key,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  amount_cents integer not null,
  status text not null check (status in ('pending','authorized','captured','released','refunded')),
  authorization_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists escrows_payment_intent_idx on escrows (stripe_payment_intent_id);
create index if not exists escrows_status_idx on escrows (status);

create table if not exists ledger (
  id uuid primary key,
  job_id uuid,
  kind text not null check (kind in ('escrow_hold','escrow_capture','escrow_release','payout','fee','refund','stripe_cost','kyc_cost','dispute_loss')),
  amount_cents integer not null,
  currency text not null default 'usd',
  stripe_ref text,
  idempotency_key text unique not null,
  created_at timestamptz not null default now()
);
create index if not exists ledger_created_at_idx on ledger (created_at);
create index if not exists ledger_job_id_idx on ledger (job_id);
create index if not exists ledger_stripe_ref_idx on ledger (stripe_ref);
-- Re-assert the kind list so a database created from an earlier version of this file picks up new kinds.
alter table ledger drop constraint if exists ledger_kind_check;
alter table ledger add constraint ledger_kind_check
  check (kind in ('escrow_hold','escrow_capture','escrow_release','payout','fee','refund','stripe_cost','kyc_cost','dispute_loss'));

create table if not exists stripe_events (
  event_id text primary key,
  type text,
  processed_at timestamptz not null default now()
);

create table if not exists worker_verifications (
  worker_id uuid not null,
  kind text not null check (kind in ('identity','notary_commission')),
  status text not null check (status in ('pending','verified','failed','needs_review')),
  provider_ref text,
  details jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  expires_at timestamptz,
  primary key (worker_id, kind)
);

create table if not exists proof_reviews (
  proof_id uuid primary key,
  job_id uuid not null,
  confidence numeric,
  decision text not null check (decision in ('approved','escalated','rejected')),
  checks jsonb not null default '[]'::jsonb,
  reviewer text,
  created_at timestamptz not null default now()
);
create index if not exists proof_reviews_job_id_idx on proof_reviews (job_id);

create table if not exists notary_registry (
  commission_number text primary key,
  full_name text,
  name_normalized text,
  county text,
  city text,
  business_name text,
  commission_expires date,
  raw jsonb,
  imported_at timestamptz not null default now()
);
create index if not exists notary_registry_name_normalized_idx on notary_registry (name_normalized);

-- One row per job. pending_onboarding = worker had no Connect account when the job settled; completed by account.updated.
create table if not exists payouts (
  job_id uuid primary key,
  worker_id uuid not null,
  amount_cents integer not null,
  status text not null check (status in ('pending_onboarding','paid')),
  stripe_transfer_id text,
  stripe_connect_account text,
  onboarding_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payouts_worker_status_idx on payouts (worker_id, status);

-- Stripe disputes (chargebacks) against captured charges; filled by charge.dispute.* webhooks.
create table if not exists disputes (
  id text primary key,                       -- Stripe dispute id (dp_...)
  job_id uuid,                               -- references jobs(id) logically; no FK so Edmond's table can evolve
  stripe_charge_id text not null,
  stripe_payment_intent_id text,
  amount_cents integer not null,
  currency text not null default 'usd',
  reason text,
  status text not null,
  evidence_due_by timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  evidence_submitted_at timestamptz,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists disputes_job_id_idx on disputes (job_id);
create index if not exists disputes_status_idx on disputes (status);
