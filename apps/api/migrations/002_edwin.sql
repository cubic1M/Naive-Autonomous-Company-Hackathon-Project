-- Edwin's additions (proposed in docs/plans/edwin.md §5). Additive only.
alter table outreach add column if not exists short_code text;           -- SMS replies: "YES 4821"
create index if not exists outreach_short_code_idx on outreach (short_code);
alter table workers add constraint workers_email_key unique (email);      -- dedupe found people by email
alter table proofs add column if not exists reviewed_by text;

create table if not exists messaging_events (                             -- every SMS in/out
  id uuid primary key default gen_random_uuid(),
  direction text not null,             -- in | out
  provider text,                       -- mobilerun | monid_agentline
  provider_id text,
  phone text,
  body text,
  job_id uuid references jobs,
  worker_id uuid references workers,
  status text,
  created_at timestamptz default now()
);

create table if not exists agent_events (                                 -- Naïve webhooks → dashboard agent feed
  id uuid primary key default gen_random_uuid(),
  type text,
  agent_id text,
  session_id text,
  summary text,
  payload jsonb,
  created_at timestamptz default now()
);

create table if not exists webhook_events (                               -- dedupe vendor webhook retries
  provider text,
  event_id text,
  type text,
  created_at timestamptz default now(),
  primary key (provider, event_id)
);
