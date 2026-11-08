-- Sign in with Google: remember each account's Google user id (stable even if the Gmail address changes).
alter table worker_accounts add column if not exists google_sub text;
create unique index if not exists worker_accounts_google_sub_key on worker_accounts (google_sub) where google_sub is not null;
