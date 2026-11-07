-- Self-serve customer keys (POST /v1/customers)
alter table customers add column if not exists signup_ip text;
alter table customers add column if not exists description text;
create index if not exists customers_signup_ip_idx on customers (signup_ip, created_at);
create index if not exists jobs_customer_created_idx on jobs (customer_id, created_at);
