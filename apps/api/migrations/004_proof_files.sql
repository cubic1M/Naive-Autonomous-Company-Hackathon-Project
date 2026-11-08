-- Proof media stored in Postgres when Vercel Blob isn't configured (served at /v1/files/:id).
create table if not exists proof_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs,
  mime text not null,
  name text,
  bytes bytea not null,
  created_at timestamptz default now()
);
