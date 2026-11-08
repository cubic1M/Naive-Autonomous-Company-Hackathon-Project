# services/payments — Cameron

Implemented in [`services/money-verification`](../money-verification/README.md) (one package for the Finance and Verifier tools, since they share the escrow, ledger and proof-review tables).

Finance tools: `create_escrow`, `capture_escrow` (`capture_payment`), `release_escrow`, `refund` (**ask**), `release_payout` (`payout`; refuses over $150), `release_payout_large` (**ask**), `settle_job`, `ledger`. Contract-shaped adapters for `contracts/tools.ts` live in `src/contract-tools.ts`.

- Hold: Stripe Checkout, `capture_method: manual`. Webhook → `onJobFunded` → job `held` → wakes CEO.
- Payout only if the proof review is `approved` and the charge is captured; over $150 → `requires_approval` (`over_limit`).
- Worker without a Connect account → `pending_onboarding` (`needs_bank_setup`) with an onboarding URL.
- Every money movement writes a `ledger` row (integer cents, idempotency-keyed).
