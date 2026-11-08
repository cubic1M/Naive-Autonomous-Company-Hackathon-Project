-- services/money-verification/migrations/0003_job_liability.sql
-- Per-job liability model (docs/specs/2026-11-08-liability-model-design.md). Idempotent; safe to re-run.
create table if not exists job_liability (
  job_id uuid primary key,
  tags jsonb not null default '{}'::jsonb,
  pricing text not null check (pricing in ('standard','connector')),
  model text check (model in ('operis','connector','refuse')),
  rule_id text,
  reason text,
  policy_version text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists job_liability_undecided on job_liability (created_at) where model is null;

-- Attorney licence checks join the verification kinds created in 0001.
alter table worker_verifications drop constraint if exists worker_verifications_kind_check;
alter table worker_verifications add constraint worker_verifications_kind_check
  check (kind in ('identity','notary_commission','attorney_license'));
