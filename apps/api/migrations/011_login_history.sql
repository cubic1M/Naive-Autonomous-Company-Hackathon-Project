-- Sign-in history shown to the worker ("Last sign-in: Google, today 10:31 PM · before that: password, Nov 7").
alter table worker_accounts add column if not exists last_login_at timestamptz;
alter table worker_accounts add column if not exists last_login_method text;
alter table worker_accounts add column if not exists prev_login_at timestamptz;
alter table worker_accounts add column if not exists prev_login_method text;
alter table worker_accounts add column if not exists google_connected_at timestamptz;
