# Stripe: going live

How Operis moves from the Operis sandbox (`acct_1UZBJd9CT0j2nFRs`) to live Stripe on the Operis account
(`acct_1UZJdc7q4mxNVt6u`). Owners: Cameron (Stripe dashboard, keys, smoke test), Edwin (env, migration, deploy).
Agents never create, read or paste a key or a signing secret.

## 1. What the code does under a live key

- **Mode detection.** `STRIPE_SECRET_KEY` must start with `sk_live_`, `rk_live_`, `sk_test_` or `rk_test_`; any other
  value is a config error (`services/money-verification/src/stripe-mode.ts`). No key = test (read-only tools).
- **Stored ids are mode-scoped.** A live key cannot see sandbox objects, and a Stripe id does not say its mode.
  Migration `0005_stripe_livemode.sql` adds `customers.stripe_livemode`, `workers.stripe_connect_livemode` and
  `worker_verifications.stripe_livemode` (null = written before the migration = sandbox). The repo returns ids of the
  other mode as absent, so under a live key:
  - a customer's sandbox Customer and saved card are gone: `request_human` falls back to a Checkout link, and
    `setup_payment` creates a live Stripe Customer; the owner saves a real card once;
  - a worker's sandbox Express account is gone: the first payout parks as `pending_onboarding` and sends them
    through live Connect onboarding;
  - a worker's sandbox Identity result is gone: licensed work and tier-2 jobs need a live ID check again
    (notary/attorney registry checks are not Stripe objects and stay).
  Writes stamp the mode. The first live write on a customer drops the sandbox card instead of merging with it.
  Nothing is deleted: back on a test key, sandbox ids still on file are visible again.
- **Before the migration** a test-key deployment keeps working (old SQL). A live-key deployment refuses Stripe-id
  writes (Postgres 42703). So **run migration 0005 before deploying with a live key**.
- **Webhooks.** `STRIPE_WEBHOOK_SECRET` may hold two secrets, comma-separated (account endpoint + Connect endpoint).
  A deployment with a live key answers 200 and ignores test-mode events (`ignored: "test-mode event; ..."`), so a
  sandbox endpoint left pointing at it cannot act. Live events are handled like sandbox ones.
- **Text.** `pm_card_visa` and card 4242 appear in `/llms.txt`, the MCP instructions and the `request_human` schema
  only under a test key. An unknown `payment.payment_method` under a live key says test ids do not work in live mode.

Not mode-scoped (known limits, see the PR): sandbox **jobs in flight** (their PaymentIntents and charges are sandbox
objects: capture, cancel and refund fail with `resource_missing` under a live key), the **ledger** (the rolling 24 h
hold cap and the `ledger` tool count sandbox lines too), and `worker_accounts.identity_status` (the "cleared" badge on
the job page).

## 2. Order of operations

1. Finish or cancel every sandbox job that holds a card (status `held` through `approved`). Do it on the test key.
2. Merge the PR (Cameron).
3. Run `npm run db:migrate` (Edwin). Applies `0005_stripe_livemode.sql`; additive, safe on the test key.
4. Create the two live webhook endpoints and the restricted key (Cameron, section 3 and 4).
5. Set the live env and deploy (Edwin, section 5).
6. Run the smoke test (Cameron, section 6).

**Rollback:** put the sandbox `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` back and redeploy. Live objects then
read as absent; sandbox ids that were not overwritten come back.

## 3. Live webhook endpoints (Stripe dashboard, live mode, account Operis)

Event types the handler routes (`services/money-verification/src/webhooks/stripe.ts`, `handleStripeEvent`).

**Endpoint A: "Your account"**
- URL: `https://api.operis.live/webhooks/stripe`
- API version: `2026-10-28.endive` (the version the sandbox endpoint `we_1UZJqc9CT0j2nFRsZFT7NW4H` runs, which
  the code was tested against)
- Events (12):
  `checkout.session.completed`, `payment_intent.amount_capturable_updated`, `payment_intent.canceled`,
  `charge.refunded`, `refund.created`, `refund.updated`,
  `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`,
  `identity.verification_session.verified`, `identity.verification_session.requires_input`,
  `identity.verification_session.canceled`

**Endpoint B: "Connected accounts"**
- URL: the same, `https://api.operis.live/webhooks/stripe`
- API version: the same
- Events (1): `account.updated`

Why two: `account.updated` for a worker's Express account is an event on the *connected* account, which only a
Connect endpoint receives. The sandbox endpoint is an account endpoint, so it never got workers' onboarding
updates. It also lacked `payment_intent.amount_capturable_updated`, which funds Checkout holds whichever event
arrives first.

Each endpoint has its own signing secret. Give Edwin both, as one value: `STRIPE_WEBHOOK_SECRET=<whsec A>,<whsec B>`.

## 4. Restricted key (`rk_live_...`)

Every Stripe call in the code goes through `src/stripe-client.ts`. Grant these and leave everything else at None:

| Dashboard resource | Permission | Used by |
|---|---|---|
| Checkout Sessions | Write | `checkout.sessions.create` (job Checkout, card setup) |
| PaymentIntents | Write | `paymentIntents.create`, `.capture`, `.cancel` (holds) |
| SetupIntents | Read | `setupIntents.retrieve` (the saved card after setup Checkout) |
| Customers | Write | `customers.create` |
| Refunds | Write | `refunds.create` |
| Disputes | Write | `disputes.update` (evidence) |
| Connect: Accounts | Write | `accounts.create`, `accounts.retrieve` (Express) |
| Connect: Account Links | Write | `accountLinks.create` (onboarding link) |
| Connect: Transfers | Write | `transfers.create` (worker payout) |
| Identity: Verification Sessions and Reports | Write | `verificationSessions.create`, `.retrieve` |
| Identity: verified outputs (sensitive) | Read, if the dashboard lists it separately | `.retrieve(..., { expand: ['verified_outputs'] })` (verified first/last name) |

Webhook verification is local (`webhooks.constructEvent`) and needs no permission. If the key lacks the Identity
sensitive-output access, verification still completes but the verified name stays empty
(`details.verified_outputs_error`), which fails the notary/attorney name match.

## 5. Env (Edwin, Vercel project operis-api, Production)

```
STRIPE_SECRET_KEY=rk_live_...            # from Cameron (or sk_live_)
STRIPE_WEBHOOK_SECRET=whsec_A,whsec_B    # both live endpoints, comma-separated
DAILY_ESCROW_CAP_CENTS=10000             # $100 of new holds per rolling 24 h, all customers
PAYOUT_CAP_CENTS=5000                    # $50: larger payouts or refunds need the CEO agent's *_large approval
# DAILY_HOLD_CAP_CENTS: remove it (alias of DAILY_ESCROW_CAP_CENTS, which wins when both are set)
```

Then deploy (`npx vercel deploy --prod --yes` from the repo root, see GO_LIVE.md).

Why these caps: a $20 job holds $20 and pays the worker $15, so the smoke test fits with room for a few demo jobs.
The code defaults are $2,000/day and $150/payout. The 24 h cap also counts sandbox holds from the last day (the
ledger has no mode). Read-only check before the smoke test:
`select coalesce(sum(amount_cents), 0) from ledger where kind = 'escrow_hold' and created_at > now() - interval '24 hours';`
If that is near the cap, raise `DAILY_ESCROW_CAP_CENTS` by that amount for today.

## 6. Live smoke test (Cameron runs it, real money: about $20 plus Stripe fees and one Identity check)

Before: sections 2 to 5 done; you have an Operis API key whose customer is you; a teammate has a worker account.

1. **Live text.** `curl -s https://api.operis.live/llms.txt | grep -c pm_card_visa` prints `0`.
2. **Save your card.** Call `setup_payment` (MCP), or `POST https://api.operis.live/v1/customers/payment-setup`
   with your key. Open the `url`, save your real card. Expect, in the live dashboard: a Customer with metadata
   `operis_customer_id`; Endpoint A delivered `checkout.session.completed` with 200.
3. **Request a $20 job.** `request_human` with `budget_usd: 20`, an easy task, a deadline at least an hour away.
   Expect `status: "held"`, `escrow_url: null`. Dashboard: a $20.00 PaymentIntent, Uncaptured.
4. **Either cancel** (stop here to release the hold): `cancel_job` before a worker accepts. Expect the
   PaymentIntent Canceled, `payment_intent.canceled` delivered 200, job `refunded`. Done.
5. **Or complete it.** The teammate accepts the job from the link, then runs the ID check from the job page
   (`POST /v1/worker/identity` with the job token) or their account (`POST /v1/me/identity/session`): live Stripe
   Identity, real document and selfie. Expect `identity.verification_session.verified` delivered 200. A "verified"
   badge left over from the sandbox is `worker_accounts.identity_status`, which is not mode-scoped: start the live
   check anyway; the money side (`worker_verifications`) needs it for licensed and tier-2 work.
6. The teammate does the task and submits proof. When it is approved, the hold is captured: the PaymentIntent shows
   Succeeded, $20.00.
7. **Payout.** With no live Express account yet, the payout parks as `pending_onboarding` with an onboarding link
   (the teammate can also get one first from `POST /v1/worker/payout-setup` with the job token). They finish live
   Express onboarding with their real details and bank account. Endpoint B delivers `account.updated` with 200;
   the parked payout completes: a $15.00 Transfer to their account, job `paid`.
8. **Check.** Both endpoints show only 200s, and no response body says `ignored` (that would mean a test event
   reached the live deployment). Do not refund a paid job from the dashboard as a test: the worker was already paid.

If anything fails: cancel the job (releases the hold), then roll back the env (section 2).
