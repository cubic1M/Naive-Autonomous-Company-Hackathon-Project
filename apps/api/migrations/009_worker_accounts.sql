-- Worker accounts on operis.live (sign in with Google). Separate from `workers` (people outreach found):
-- an account is someone who signed in themselves. Sessions are opaque cookies; only a SHA-256 is stored.
create table if not exists worker_accounts (
  id text primary key,                       -- wrk_…
  email text unique not null,                -- lowercased, verified by Google
  name text not null default '',
  phone text not null default '',
  google_sub text unique,                    -- Google's stable user id
  profile jsonb not null default '{}',       -- onboarding answers (skills, alerts, radius, …)
  agreed_terms_at timestamptz,
  created_at timestamptz default now(),
  last_login_at timestamptz
);
create table if not exists worker_sessions (
  token_hash text primary key,
  account_id text not null references worker_accounts(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
create index if not exists worker_sessions_account on worker_sessions (account_id);
