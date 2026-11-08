-- post_social (services/growth/src/social.ts): every attempt by the Sales agent to post from Operis's own accounts on
-- X, Threads and Bluesky, posted or not. The daily cap, the 60-minute gap and the no-repeat rule are reads over this
-- table. Its own table, not a growth_log kind: it needs the platform, the text and its hash. Runs after
-- 0001_growth.sql. Idempotent. Changes no other table. Owner: Cameron.

create table if not exists growth_social_posts (
  id uuid primary key default gen_random_uuid(),               -- also the Idempotency-Key sent to Zernio
  platform text not null check (platform in ('x', 'threads', 'bluesky')),
  -- pending: handed to Zernio, outcome not recorded yet; unknown: may be live (timeout, 5xx, held). Both count as posted.
  status text not null check (status in ('pending', 'posted', 'unknown', 'dry_run', 'skipped', 'failed')),
  reason text,                                                  -- why skipped, failed or unknown
  body text not null,                                           -- exactly what was, or would have been, posted (disclosure line included)
  body_hash text not null,                                      -- sha256 of the normalized words: the exact-repeat check
  provider text,                                                -- 'zernio'
  provider_post_id text,                                        -- Zernio's post _id (GET /v1/posts/{id})
  url text,                                                     -- the live post
  created_at timestamptz not null default now()
);
create index if not exists growth_social_posts_platform_created_idx on growth_social_posts (platform, created_at);
