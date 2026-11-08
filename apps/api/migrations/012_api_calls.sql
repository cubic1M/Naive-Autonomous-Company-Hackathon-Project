-- Every call customer agents make to us (MCP + sign-up/OAuth), for the founders' live view. Idempotent.
create table if not exists api_calls (
  id bigserial primary key,
  at timestamptz not null default now(),
  customer_id uuid,
  customer_name text,
  channel text not null,            -- mcp | signup | oauth
  method text,                      -- initialize, tools/list, tools/call, ...
  tool text,                        -- request_human, get_job, ...
  outcome text not null,            -- ok | rejected | error | unauthorized
  http_status int,
  duration_ms int,
  job_id uuid,
  summary text,
  client text,                      -- MCP clientInfo or User-Agent
  ip text
);
create index if not exists api_calls_at on api_calls (at desc);
create index if not exists api_calls_customer on api_calls (customer_id, at desc);
