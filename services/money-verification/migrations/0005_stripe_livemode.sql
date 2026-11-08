-- Money & Verification: which Stripe mode each stored Stripe id belongs to (test -> live cutover).
-- A live key cannot see objects created with a test key (resource_missing), and a Stripe id does not say its mode,
-- so the rows that store one also store the mode it was created in. PostgresRepo treats ids of the other mode than
-- STRIPE_SECRET_KEY's as absent and stamps the mode on every write.
--   customers.stripe_livemode             mode of stripe_customer_id and default_payment_method_id (migration 0002)
--   workers.stripe_connect_livemode       mode of stripe_connect_account (Connect Express account)
--   worker_verifications.stripe_livemode  mode of provider_ref for kind 'identity' (Stripe Identity session);
--                                         null for notary/attorney rows, which are not Stripe objects
-- null = written before this migration, when only the sandbox existed: read as test. No backfill, nothing deleted:
-- switching back to a test key sees the sandbox ids again (until a write in live mode replaces them).
-- Additive and idempotent. Run it BEFORE deploying with a live key: a live-mode repo refuses to write without it.
alter table customers add column if not exists stripe_livemode boolean;
alter table workers add column if not exists stripe_connect_livemode boolean;
alter table worker_verifications add column if not exists stripe_livemode boolean;
