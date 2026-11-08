-- Growth tables for the Sales and Recruiter agents (services/growth; docs/specs/2026-11-08-sales-recruiter-design.md).
-- Runs after contracts/schema.sql and services/outreach/migrations. Idempotent. Owner: Cameron.
-- Changes no shared table: reads jobs, customers and worker_verifications; references workers and jobs.

create table if not exists growth_contacts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('prospect', 'recruit')),   -- prospect: hand-sourced (Sales); recruit: recruit_search
  email text not null check (email = lower(email)),
  name text,
  org text,
  family text check (family in ('pier70_gigs', 'sf_notaries', 'ca_attorneys', 'developers')),
  worker_id uuid references workers(id) on delete set null,     -- recruits: the person in the talent pool
  found_via text not null,                                      -- quoted in every email: "How we found you: ..."
  notes text,
  free_first_job boolean not null default false,
  opted_out boolean not null default false,                     -- never cleared
  opted_out_at timestamptz,
  joined_at timestamptz,                                        -- clicked "Yes, send me jobs"
  last_contacted_at timestamptz,                                -- last real send
  created_at timestamptz not null default now(),
  unique (kind, email)
);
create index if not exists growth_contacts_email_idx on growth_contacts (email);
create index if not exists growth_contacts_worker_idx on growth_contacts (worker_id);

create table if not exists growth_log (                         -- caps, budgets and the audit trail are sums over this
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references growth_contacts(id) on delete set null,
  kind text not null check (kind in ('marketing', 'invite', 'search', 'unsubscribe', 'join', 'identity', 'suppress')),
  status text not null check (status in ('sent', 'dry_run', 'skipped', 'failed', 'ok')),
  reason text,
  family text,
  cost_usd numeric not null default 0,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists growth_log_kind_created_idx on growth_log (kind, created_at);

create table if not exists growth_promos (                      -- free-first-job grants, one per team
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references growth_contacts(id),
  grant_key text not null unique,                               -- company domain, or the full address at free-mail providers
  cap_cents integer not null check (cap_cents > 0),
  expires_at timestamptz not null,
  redeemed_job_id uuid unique references jobs(id),
  refund_cents integer,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
