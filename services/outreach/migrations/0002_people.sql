-- Individuals anywhere (LinkedIn, GitHub, X, Reddit, personal sites) + the manual DM queue (owner: Andrew).
-- Runs after 0001_outreach.sql. Idempotent.

alter table worker_profiles add column if not exists profiles jsonb not null default '[]';      -- [{platform,url,handle}]
alter table worker_profiles add column if not exists headline text;
alter table worker_profiles add column if not exists location_text text;
alter table worker_profiles add column if not exists credentials jsonb not null default '[]';
alter table worker_profiles add column if not exists open_to_work boolean not null default false;
alter table worker_profiles add column if not exists last_active_at timestamptz;

-- NEEDS EDWIN'S OK: jobs is his table. true = online work with no location (legal, software, design...).
alter table jobs add column if not exists remote boolean not null default false;

-- DMs the agent drafted for a teammate to send by hand from a real Operis account
-- (LinkedIn InMail / X / Reddit / Instagram: platforms ban automated DMs).
create table if not exists manual_outreach (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs,
  worker_id uuid references workers,
  platform text,                       -- linkedin | x | reddit | instagram
  profile_url text,
  message text,
  status text default 'queued',        -- queued | sent | skipped
  created_at timestamptz default now(),
  sent_at timestamptz,
  unique (job_id, worker_id, platform)
);
create index if not exists manual_outreach_status_idx on manual_outreach (status, platform, created_at);
