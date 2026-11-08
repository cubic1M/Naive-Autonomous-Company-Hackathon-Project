-- Talent pool search (owner: Andrew). Runs after 0002_people.sql. Idempotent.
-- searchPool() filters on contactability + a lowercase text match; these indexes keep the ordering and the
-- "contactable people" scan cheap for pools of tens of thousands.
create index if not exists worker_profiles_pool_order_idx on worker_profiles (open_to_work desc, last_active_at desc nulls last);
create index if not exists workers_pool_email_idx on workers (email) where email is not null;
