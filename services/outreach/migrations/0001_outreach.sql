-- Outreach package tables (owner: Andrew). Runs after contracts/schema.sql.
-- Does not change shared tables; adds a 1:1 profile table next to `workers`.

create table if not exists worker_profiles (
  worker_id uuid primary key references workers(id) on delete cascade,
  dedupe_key text unique not null,        -- e.g. "email:jobs@acme.com", "phone:+14155550142", "place:ChIJ..."
  kind text not null default 'business',  -- business | person
  website text,
  profile_url text,
  address text,
  lat double precision,
  lng double precision,
  categories jsonb not null default '[]',
  rating numeric,
  snippet text,
  regular boolean not null default false, -- said "send me more jobs"
  sms_consent boolean not null default false,
  last_contacted_at timestamptz,
  source_ref text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists worker_profiles_regular_idx on worker_profiles (regular) where regular;
create index if not exists worker_profiles_geo_idx on worker_profiles (lat, lng);

-- One message per (job, person): blasting twice is a no-op.
create unique index if not exists outreach_job_worker_uidx on outreach (job_id, worker_id);
create index if not exists workers_email_lower_idx on workers (lower(email));
create index if not exists workers_phone_idx on workers (phone);
