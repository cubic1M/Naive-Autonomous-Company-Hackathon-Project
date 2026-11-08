-- Agent activity feed pulled from Naïve session events (the webhook only delivers session.idle).
alter table agent_events add column if not exists agent text;
alter table agent_events add column if not exists job_id uuid;
alter table agent_events add column if not exists event_seq int;
create unique index if not exists agent_events_session_seq_uidx on agent_events (session_id, event_seq) where event_seq is not null;
create index if not exists agent_events_job_idx on agent_events (job_id, created_at);
create table if not exists agent_feed_cursors (
  session_id text primary key,
  next_cursor text,
  done boolean default false,
  updated_at timestamptz default now()
);
create table if not exists app_state (key text primary key, value text, updated_at timestamptz default now());
