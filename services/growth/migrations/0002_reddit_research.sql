-- reddit_research (services/growth/src/reddit.ts): the Sales agent's read-only Reddit research through Monid.
-- One row per Monid call. Its daily budget (GROWTH_REDDIT_DAILY_USD) is the sum of cost_usd since Pacific midnight,
-- kept apart from growth_log so it never mixes with recruit_search's budget. Idempotent. Owner: Cameron.
-- Until this runs, reddit_research refuses before calling Monid (the budget query fails first).

create table if not exists growth_reddit_calls (
  id uuid primary key default gen_random_uuid(),
  op text not null check (op in ('rules', 'search')),
  subreddit text not null,
  query text,                                                   -- search only
  endpoint text not null,                                       -- provider + endpoint, e.g. anyapi/reddit.subreddit_search
  status text not null check (status in ('ok', 'failed')),
  cost_usd numeric not null default 0,                          -- an estimate when the call threw or timed out
  reason text,
  run_id text,                                                  -- Monid run: GET /v1/runs/{run_id} has the full response
  created_at timestamptz not null default now()
);
create index if not exists growth_reddit_calls_created_idx on growth_reddit_calls (created_at);
