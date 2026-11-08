-- Worker accounts (apps/web/docs/ACCOUNTS_API.md). Separate from `workers` because outreach can hold several
-- rows for one person; an account points at the worker row its jobs go to. Idempotent.
create table if not exists worker_accounts (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references workers(id),
  name text not null,
  email text not null,
  phone text,
  password_hash text,
  email_verified_at timestamptz,
  identity_status text not null default 'unverified',
  id_type text,
  profile jsonb not null default '{}'::jsonb,   -- skills, licenses, profiles, permissions, alerts, min_pay, radius, quiet_hours, onboarding
  agreed_terms_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists worker_accounts_email_key on worker_accounts (lower(email));
create unique index if not exists worker_accounts_phone_key on worker_accounts (phone) where phone is not null and phone <> '';

create table if not exists worker_sessions (
  token_hash text primary key,
  account_id uuid not null references worker_accounts(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists worker_sessions_account on worker_sessions (account_id);

-- Login links and password resets (single use; only the hash is stored).
create table if not exists auth_links (
  token_hash text primary key,
  kind text not null check (kind in ('login','reset')),
  account_id uuid not null references worker_accounts(id) on delete cascade,
  next text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Continue with Google (PR #50): Google's stable user id, and when the account last signed in.
alter table worker_accounts add column if not exists google_sub text;
alter table worker_accounts add column if not exists last_login_at timestamptz;
create unique index if not exists worker_accounts_google_sub_key on worker_accounts (google_sub) where google_sub is not null;
