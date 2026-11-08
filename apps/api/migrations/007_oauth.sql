-- MCP OAuth (authorization code + PKCE, dynamic client registration). Access tokens are Operis customer keys.
create table if not exists customer_keys (            -- extra keys per customer (OAuth connections); customers.api_key_hash stays the first key
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers on delete cascade,
  key_hash text unique not null,
  label text,
  revoked boolean default false,
  created_at timestamptz default now(),
  last_used_at timestamptz
);
create table if not exists oauth_clients (
  client_id text primary key,
  client_name text,
  redirect_uris jsonb not null,
  created_at timestamptz default now()
);
create table if not exists oauth_codes (
  code_hash text primary key,
  client_id text not null references oauth_clients,
  customer_id uuid not null references customers,
  redirect_uri text not null,
  code_challenge text not null,
  scope text,
  resource text,
  expires_at timestamptz not null,
  used boolean default false
);
create table if not exists oauth_refresh_tokens (
  token_hash text primary key,
  client_id text not null references oauth_clients,
  customer_id uuid not null references customers,
  revoked boolean default false,
  created_at timestamptz default now()
);
