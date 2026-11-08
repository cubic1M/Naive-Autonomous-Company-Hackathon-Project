-- 002 added a unique constraint on workers.email for the mocks; Andrew's outreach saves people by its own
-- dedupe key (worker_profiles.dedupe_key) and can legitimately meet the same email twice. Drop it.
alter table workers drop constraint if exists workers_email_key;
