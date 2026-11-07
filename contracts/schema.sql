-- SHARED CONTRACT. Change only after the team agrees. See docs/FLOW.md.
-- Job states: contracts/states.ts

create table customers (
  id uuid primary key default gen_random_uuid(),
  name text,
  api_key_hash text unique,
  contact_email text,
  created_at timestamptz default now()
);

create table workers (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  phone text,
  source text,                         -- where we found them (Andrew)
  opted_out boolean default false,     -- never contact again once true
  stripe_connect_account text,         -- set on first payout (Cameron)
  certifications jsonb default '[]',
  rating numeric default 5.0,
  jobs_done int default 0,
  created_at timestamptz default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers,
  title text not null,
  instructions text not null,
  address text, lat double precision, lng double precision,
  deadline timestamptz,
  budget_usd numeric not null,
  fee_usd numeric,
  worker_pay_usd numeric,
  certification_required text,
  proof_requirement jsonb not null,
  status text not null default 'requested',
  worker_id uuid references workers,
  stripe_payment_intent text,
  naive_session_id text,               -- reuse for follow-up wake-ups (Edwin)
  callback_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table outreach (                 -- Andrew
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs,
  worker_id uuid references workers,
  channel text,                        -- email | sms
  token text unique,                   -- signed job link: /j/[token]
  status text default 'sent',          -- sent | opened | accepted | declined
  created_at timestamptz default now()
);

create table proofs (                   -- Cameron
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs,
  worker_id uuid references workers,
  media jsonb,                         -- [{url, kind, exif}]
  fields jsonb,
  gps_lat double precision, gps_lng double precision,
  captured_at timestamptz,
  verifier_score numeric,
  verifier_notes text,
  status text default 'submitted',     -- submitted | approved | escalated | rejected
  created_at timestamptz default now()
);

create table ledger (                   -- Cameron; CEO's P&L is a sum over this
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs,
  kind text not null,                  -- hold | capture | payout | fee | refund | stripe_cost | sms_cost | scrape_cost
  amount_usd numeric not null,
  ref text,
  created_at timestamptz default now()
);

create table wake_events (              -- idempotent agent wake-ups (Edwin)
  job_id uuid references jobs,
  event text,
  naive_session_id text,
  created_at timestamptz default now(),
  primary key (job_id, event)
);
