-- Founder login attempts (rate limiting for POST /v1/admin/login)
create table if not exists admin_login_attempts (
  ip text not null,
  email text,
  ok boolean not null,
  created_at timestamptz default now()
);
create index if not exists admin_login_attempts_ip_idx on admin_login_attempts (ip, created_at);
