-- services/money-verification/migrations/0004_job_liability_backfill.sql
-- Jobs that existed before the per-job liability model shipped (docs/specs/2026-11-08-liability-model-design.md) get a
-- legacy decision, so the Ops gate and the sweep treat them as decided: operis under rule D, which is how Operis ran
-- them. Jobs still in 'requested' get their row when they are funded, as new jobs do.
-- Idempotent: a job that already has a row (every job created since the model shipped) is left alone.
-- A file of its own rather than an edit to 0003, because 0003 may already be applied and scripts/migrate.ts runs a
-- file once.
insert into job_liability (job_id, tags, pricing, model, rule_id, reason, policy_version, decided_by, decided_at)
select j.id, '{"rules":[],"forced":null,"hints":[]}'::jsonb, 'standard', 'operis', 'D', 'job predates the liability policy',
       '2026-11-08', 'legacy', now()
from jobs j
where j.status <> 'requested'
on conflict (job_id) do nothing;
