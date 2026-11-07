# services/payments — Cameron

Tools for the **Finance** agent: `capture_payment`, `payout`, `refund`, `ledger`. Plus the Stripe hold created at `request_human` time.

- Hold: Stripe Checkout, `capture_method: manual`. Webhook → job `held` → wakes CEO.
- `payout` only if job is `approved`, ≤ budget, ≤ $150 (above → `over_limit`; Naïve permission is ask).
- Worker without a Connect account → `needs_bank_setup` → they get the `/payout` link.
- Every money movement writes a `ledger` row.
