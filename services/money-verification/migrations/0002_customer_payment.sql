-- Card on file for customer agents (agent-payable escrow). Idempotent; run by scripts/migrate.ts or by hand.
-- Adds two columns to Edwin's `customers` table (contracts/schema.sql); touches nothing else.
--   stripe_customer_id         Stripe Customer created on the first payment-setup link (cus_...)
--   default_payment_method_id  PaymentMethod saved by the setup-mode Checkout session (pm_...);
--                              when set, request_human funds the job directly (escrow_url: null).
alter table customers add column if not exists stripe_customer_id text;
alter table customers add column if not exists default_payment_method_id text;
create index if not exists customers_stripe_customer_id_idx on customers (stripe_customer_id);
