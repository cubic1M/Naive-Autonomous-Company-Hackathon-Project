# money-verification

Operis's money and verification layer: it holds the customer's card (Stripe Checkout, manual capture), verifies the worker's proof, captures the charge, and pays the worker 75% through Stripe Connect Express. Operis keeps 25%; the minimum job is $20; a $60 job pays the worker $45 and Operis $15. Workers connect a bank account once, on their first payout. Payouts over $150 require founder approval. Chargebacks are tracked for the Disputes agent.

ESM, strict TypeScript, Node 22, vitest. Every external call goes through an injected client (a `StripeClient` subset and a `Repo`); nothing in this package reads `process.env` except `envFromProcess()`. Owner: Cameron. Edwin owns the shared `jobs` / `workers` / `proofs` tables and the MCP server that registers the tools below.

**Status (Sat Nov 7):** all code is exercised by 165 tests against a fake Stripe client and an in-memory repo, with real webhook-signature verification. It has **not yet been run against a live Stripe test account or a real Postgres**; the Stripe CLI walkthrough below is that first run.

## Layout

| Module | Exports |
|---|---|
| `src/pricing.ts` | `quote(priceCents, payoutCapCents?)` → `{ priceCents, workerPayCents, feeCents, requiresApproval }`; `quoteFromBudgetUsd(budgetUsd)`. Fee = 25% of the price rounded half-up, worker = remainder, minimum 2000 cents. |
| `src/escrow.ts` | `createEscrow(deps, job)` → `{ url, escrow }` (Checkout, `capture_method: manual`, `transfer_group: job:<id>`, idempotency `escrow:<jobId>`, rolling-24h `DAILY_ESCROW_CAP_CENTS`); `markAuthorized`, `captureEscrow`, `releaseEscrow`, `markReleased`, `refund`, `markRefunded`, `expireStaleEscrows(deps, now)` (7-day authorization TTL). |
| `src/payouts.ts` | `payWorker(deps, jobId, { allowLarge?, accountReady? })` → `{ status: 'paid', transferId, amountCents, transferred }` \| `{ status: 'pending_onboarding', accountId, onboardingUrl, amountCents }`; `createConnectAccount`, `createOnboardingLink`, `isPayoutReady`, `completePendingPayoutsForWorker(deps, workerId)`. |
| `src/settle.ts` | `settleApprovedJob(deps, jobId)` → `{ chargeId, payout }`: approved review → capture → payout, fully idempotent. |
| `src/ledger.ts` | `record(repo, { jobId, kind, amountCents, idempotencyKey, stripeRef })`, `pnl(repo, { from, to })`, `sumKind`. Kinds: `escrow_hold`, `escrow_capture`, `escrow_release`, `payout`, `fee`, `refund`, `stripe_cost`, `kyc_cost`, `dispute_loss`. |
| `src/webhooks/stripe.ts` | `handleStripeWebhook(deps, Request)` → `Response`; `createStripeWebhookHandler(deps)`; `handleStripeEvent(deps, event)`. |
| `src/disputes.ts` | `recordDisputeEvent`, `getDisputeBundle`, `submitDisputeEvidence(deps, disputeId, evidence, { submit = false })`. |
| `src/proof/exif.ts`, `checks.ts`, `vision.ts`, `decide.ts` | `readExif` / `fetchMedia`; `runChecks` (geofence, time window, completeness, reuse); `VisionScorer` + `openAiCompatibleScorer` + `scorerFromEnv(env)`; `reviewProof(deps, proofId)`, `approveProof`, `escalateProof`, `rejectProof`. Decision: **rejected** on a geofence or media-reuse failure; **approved** only when every check passes and vision confidence ≥ 0.85 with every must-show item found; otherwise **escalated**. Video without a frame extractor escalates. |
| `src/certs/notary.ts`, `names.ts` | `parseNotaryListing`, `importNotaryListing`, `verifyNotary(deps, { workerId, commissionNumber, name, jobDate })` → `verified` \| `needs_review` (partial name match) \| `failed` (unknown, expired, or name mismatch). |
| `src/eligibility.ts` | `checkEligibility(deps, { workerId, jobId })` → `{ eligible, reasons }`. |
| `src/tools.ts`, `src/tools/schemas.ts` | `createTools(deps)`, `callTool(deps, name, input)`, `toolSchemas`, `TOOL_NAMES`, `TOOL_ALIASES`, `resolveToolName`, `describeToolError`. |
| `src/repo.ts`, `src/repo/memory.ts`, `src/repo/postgres.ts` | `Repo` interface; `InMemoryRepo` (tests, demos); `PostgresRepo(sqlClient)` where `sqlClient` is any `{ query(text, params) }`, such as a `@neondatabase/serverless` `Pool`. |
| `src/hooks.ts`, `src/env.ts`, `src/stripe-client.ts` | `Hooks` (below); `Env` + `envFromProcess()`; `StripeClient` subset + `fromStripe(new Stripe(key))`. |

`src/index.ts` re-exports all of it.

## Internal MCP tools

All inputs are validated with zod (`src/tools/schemas.ts`); money is integer cents; ids are UUIDs except Stripe ids.

| Tool | Input | Returns | Naïve permission |
|---|---|---|---|
| `create_escrow` | `{ job_id }` | `{ job_id, checkout_url, amount_cents, status }` | allow |
| `capture_escrow` | `{ job_id }` | `{ job_id, status: 'captured', amount_cents, charge_id }` | allow |
| `release_escrow` | `{ job_id, reason? }` | `{ job_id, status: 'released' }` | allow |
| `refund` | `{ job_id, reason }` | `{ job_id, status: 'refunded', amount_cents }` | **ask** |
| `release_payout` | `{ job_id }` | `{ status: 'paid', transfer_id, worker_pay_cents, fee_cents, transferred }` or `{ status: 'pending_onboarding', onboarding_url, worker_pay_cents }` | allow; refuses over $150 with `requires_approval` |
| `release_payout_large` | `{ job_id, approved_by, approval_note? }` | same as `release_payout` | **ask** |
| `settle_job` | `{ job_id }` | `{ job_id, charge_id, payout }` | allow |
| `ledger` | `{ from?, to? }` | `{ fees_cents, payouts_cents, refunds_cents, costs_cents, gross_margin_cents, jobs_paid }` | allow |
| `get_proof_review` | `{ job_id }` or `{ proof_id }` | review `{ proof_id, job_id, decision, confidence, checks[], reviewer, created_at }` or `null` | allow |
| `approve_proof` | `{ job_id, proof_id, notes, reviewer?, override? }` | `{ job_id, proof_id, decision: 'approved' }` | allow; geofence/reuse failures can never be approved, `override` lifts only the confidence threshold |
| `escalate` | `{ job_id, proof_id, reason }` | `{ job_id, proof_id, decision: 'escalated' }` | allow |
| `verify_notary` | `{ worker_id, commission_number, name, job_date }` | `{ worker_id, status, reasons, commission_expires }` | allow |
| `check_eligibility` | `{ worker_id, job_id }` | `{ eligible, reasons }` | allow |
| `get_dispute` | `{ dispute_id }` | `{ dispute, job, proof_review, ledger }` | allow |
| `submit_dispute_evidence` | `{ dispute_id, evidence, submit = false }` | `{ dispute_id, status, submitted }` | allow for drafts; **ask** before `submit: true` |

Aliases accepted by `resolveToolName` / `callTool` (names used in the build spec and in `contracts/tools.ts`):

| Alias | Resolves to |
|---|---|
| `hold_for_job` | `create_escrow` |
| `charge_job`, `capture_payment` | `capture_escrow` |
| `release_hold` | `release_escrow` |
| `pay_worker`, `payout` | `release_payout` |
| `pay_worker_large` | `release_payout_large` |
| `escalate_proof` | `escalate` |
| `verify_certification` | `verify_notary` |

Errors: tools throw `MoneyVerificationError` subclasses with a stable `code` (`not_found`, `invalid_state`, `requires_approval`, `daily_cap_exceeded`, `not_eligible`, `webhook_signature`, `vision`). `describeToolError(err)` turns any error, including zod failures (`invalid_input`), into `{ code, message }` for the MCP response.

Registration sketch for Edwin:

```ts
import Stripe from 'stripe';
import { Pool } from '@neondatabase/serverless';
import { createTools, describeToolError, envFromProcess, fetchMedia, fromStripe, PostgresRepo, scorerFromEnv, TOOL_NAMES, toolSchemas } from '@operis/money-verification';

const env = envFromProcess();
const tools = createTools({
  stripe: fromStripe(new Stripe(process.env.STRIPE_SECRET_KEY!)),
  repo: new PostgresRepo(new Pool({ connectionString: process.env.DATABASE_URL })),
  env,
  hooks,                       // see "Hooks" below
  vision: scorerFromEnv(env),  // null until VERIFIER_* are set: every proof then escalates
  readMedia: fetchMedia(),
});

for (const name of TOOL_NAMES) {
  server.tool(name, toolSchemas[name].description, /* input schema */ ..., async (args) => {
    try { return ok(await tools[name](args)); } catch (err) { return fail(describeToolError(err)); }
  });
}
```

The tool functions validate their own input, so register whatever schema shape your MCP SDK version accepts (`toolSchemas[name].input` is a `ZodObject` for every tool except `get_proof_review`, which is a `ZodEffects` because of its "job_id or proof_id" refinement).

## Contract adapters (`contracts/tools.ts`)

`src/contract-tools.ts` (`createContractTools(deps)`) exposes the same code under the exact names and shapes in `contracts/tools.ts`, so Edwin's registry can swap each mock for the real tool without reshaping anything: `check_proof`, `approve_proof`, `escalate`, `capture_payment`, `payout`, `refund`, `ledger`. USD numbers at that boundary, cents inside.

- `check_proof` runs the automated review on the job's latest proof (persisting a `proof_reviews` row with reviewer `auto` and firing `onProofDecision`) and returns the evidence: `gps_distance_m`, `timestamp_ok`, `checklist`, `overall_score`, `flags`, plus the `decision`. A review a human already made is returned as is, never overwritten.
- `approve_proof` answers `{ error: 'outside_geofence' | 'below_threshold' | 'reused_media' }` instead of throwing (`reused_media` is new; the contract lists two codes).
- `payout` answers `{ error: 'needs_bank_setup', onboarding_url }` or `{ error: 'over_limit' }`.
- `ledger.revenue_usd` is everything captured from customers (payouts + fees); `fees_usd` is our share before costs.

## Plugging into `apps/api` (Edwin's registry)

`services/payments/index.ts` and `services/verify/index.ts` export real `ToolImpl`s (contracts/runtime.ts) backed by this package, so `apps/api/src/tools/registry.ts` picks them over the mocks with no other change: `check_proof`, `approve_proof`, `escalate`, `capture_payment`, `payout`, `refund`, `ledger`. `src/api-context.ts` does the binding: `depsFromApiContext(ctx)` builds the deps from the API's postgres.js client and `process.env`, and turns the hooks into `ctx.transition()` calls (`held`, `approved` / `escalated` / `rejected`, `paid`, `refunded`) while mirroring `proofs.status / verifier_score / verifier_notes / reviewed_by` and `workers.jobs_done`, as the mocks did. A refused transition is logged, never thrown.

- `createHold(jobId)` (exported from `services/payments`) is what `request_human` calls through `registry.createHold`; it uses a process-wide Neon pool from `DATABASE_URL`.
- `stripeWebhook(req, ctx)` (same file) is a drop-in body for `apps/api/src/app/webhooks/stripe/route.ts`: it verifies over the raw body, dedupes on event id, handles all seven events and moves the job to `held` with `stripe_payment_intent`, exactly as the current route does, plus the rest.
- The shims import `../money-verification/src/index`, whose dependencies live in `services/money-verification/node_modules`: the install step must run `npm ci` there (as for `services/outreach`). They typecheck under bundler resolution; they have not yet been compiled inside the Next app.

## Hooks (Edwin wires these)

This package never writes the `jobs` table or talks to Naïve. It fires these hooks; the API moves the job state and wakes the right agent.

| Hook | Fired when | Expected reaction |
|---|---|---|
| `onJobFunded(jobId)` | `checkout.session.completed` authorized the card | job → `held`; wake CEO |
| `onProofDecision(jobId, proofId, decision)` | a review was written (automated or manual) | job → `approved` / `escalated` / `rejected`; wake Finance on approved |
| `onWorkerPaid(jobId, workerId, transferId)` | the worker transfer was created | job → `paid`; customer callback |
| `onWorkerPayoutReady(workerId)` | Connect onboarding finished (`account.updated`) | informational |
| `onEscrowReleased(jobId, 'released' \| 'refunded')` | hold released or charge refunded | job → `cancelled` / `expired` / `refunded` |
| `onDisputeOpened(disputeId, jobId \| null)` | a chargeback was opened | wake the Disputes agent |

Hooks are awaited. A throwing hook does not roll back the money write that preceded it. Make them idempotent: webhooks retry.

## Environment variables

| Variable | Notes |
|---|---|
| `STRIPE_SECRET_KEY` | Edwin's server constructs the Stripe client; this package never reads it. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret from the dashboard endpoint or `stripe listen`. |
| `PUBLIC_BASE_URL` | No trailing slash. Checkout success/cancel and Connect return URLs. |
| `DAILY_ESCROW_CAP_CENTS` | Rolling 24h cap on new holds. Default `200000`. Alias `DAILY_HOLD_CAP_CENTS`. |
| `PAYOUT_CAP_CENTS` | Per-job payout above this needs founder approval. Default `15000`. |
| `VERIFIER_BASE_URL`, `VERIFIER_API_KEY`, `VERIFIER_MODEL` | OpenAI-compatible vision endpoint via Naïve's model router. When any is missing, `scorerFromEnv` returns `null` and every proof escalates. |
| `DATABASE_URL` | Used only by `scripts/import-notaries.ts`. |

See `.env.example`. Never commit real values.

## Database

`migrations/0001_money_verification.sql` is idempotent plain SQL (`create table if not exists`, `drop constraint if exists` + `add constraint`) and creates only this package's tables: `escrows`, `ledger`, `stripe_events`, `payouts`, `proof_reviews`, `worker_verifications`, `notary_registry`, `disputes`. It never creates or alters `jobs` / `workers` / `proofs`. The one write to a teammate's table is `workers.stripe_connect_account`, which the shared schema already defines.

Run by hand, after Edwin has reviewed it:

```sh
psql "$DATABASE_URL" -f services/money-verification/migrations/0001_money_verification.sql
```

No `drizzle-kit push`.

**Shared `ledger` table.** `contracts/schema.sql` defines `ledger (kind, amount_usd, ref)` and Edwin's and Andrew's code write cost rows (`sms_cost`, `scrape_cost`) into it. Our migration is a superset that works whichever file runs first: it creates the table with both column sets, or adds ours (`amount_cents`, `currency`, `stripe_ref`, `idempotency_key`, a unique index on the key) to the existing one. Every row we write carries `amount_cents` and `amount_usd = cents / 100`; rows written in USD only are read back as cents. `pnl()` counts `sms_cost` and `scrape_cost` as costs.

**Reading the shared `jobs` / `proofs` tables.** `PostgresRepo` reads the contract's columns as they are: `budget_usd` / `fee_usd` / `worker_pay_usd` become integer cents (fee and worker pay are derived with the 25% split when null), `proof_requirement` becomes `ProofSchema`, `certification_required` containing "notar" becomes `task_type: 'notarization'`, and media rows `{ url, kind, exif }` become `{ url, sha256: '', mime }` with the mime guessed from `kind` or the extension.

## Asks for Edwin (shared schema and API)

- `jobs.accepted_at timestamptz`, set when the worker clicks Yes. Without it the capture-time check cannot bound the window and every proof escalates to a human.
- `proofs.media` rows should carry `sha256` (hex of the file bytes) and `mime` next to `url` / `kind` / `exif` (Dora's upload endpoint can compute both). Without `sha256` the media-reuse check is skipped; without `mime` it is guessed.
- One `ledger` definition in the repo: ours is a superset of the contract's. Proposal: replace the `ledger` block in `contracts/schema.sql` with the one in our migration, or drop it and let our migration create the table.
- Delegate `apps/api/src/app/webhooks/stripe/route.ts` to `stripeWebhook(req, { sql, transition, baseUrl: baseUrl(), log: console.log })` from `@services/payments`, and add `npm ci` for `services/money-verification` to the install step. The seven contract tools are already exported from `services/payments` and `services/verify`; the rest (`create_escrow`, `release_escrow`, `release_payout_large`, `settle_job`, `get_proof_review`, `verify_notary`, `check_eligibility`, `get_dispute`, `submit_dispute_evidence`) are available through `createTools(depsFromApiContext(ctx))` when the registry grows.

## Stripe dashboard setup (test mode)

1. Enable Checkout.
2. Enable Connect with Express accounts (Settings → Connect). Set the platform name and branding: workers see the onboarding page.
3. Enable Identity (optional, for later).
4. Add a webhook endpoint `https://<app>/webhooks/stripe` with these events: `checkout.session.completed`, `payment_intent.canceled`, `charge.refunded`, `account.updated`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
5. Card authorizations expire after about 7 days. Schedule `expireStaleEscrows()` (a cron route) to release stale holds.

## End-to-end test with the Stripe CLI (Cameron)

1. `stripe login`.
2. `stripe listen --forward-to localhost:3000/webhooks/stripe` and copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`.
3. Start the API with the package wired in.
4. Create a job and call `create_escrow`; open the `checkout_url` and pay with test card `4242 4242 4242 4242` (any future date, any CVC).
5. `checkout.session.completed` arrives → escrow `authorized`, `onJobFunded` fires, job `held`.
6. Upload a proof and call `approve_proof` (`override: true` for the scripted 6 pm checkpoint while no vision scorer is configured), then `settle_job`.
7. The first payout returns `pending_onboarding` with an `onboarding_url`. Complete Express onboarding in test mode (test SSN `000-00-0000`, test routing `110000000`, account `000123456789`).
8. `account.updated` arrives → transfer created, `onWorkerPaid` fires, job `paid`.
9. Call `ledger`: `fees_cents` 1500, `payouts_cents` 4500 for a $60 job.

`stripe trigger checkout.session.completed` sends a synthetic event with no matching escrow, so the handler answers 200 with `handled: false`; use it only to check signatures and routing. `stripe trigger charge.dispute.created` exercises the disputes path the same way.

## Notary listing import

```sh
npm run import:notaries -- <file> --dry-run      # headers, delimiter, counts, skipped rows, samples
npm run import:notaries -- <file>                # needs DATABASE_URL; upserts notary_registry in batches
```

Use `--delimiter=tab|comma` and `--map=commissionNumber:<Header>,expires:<Header>,fullName:<Header>` when the headers differ from the defaults. The real California Secretary of State file has not been seen: run the dry run first and read the skipped rows.

## Tests

```sh
npm test            # vitest: fake Stripe client + in-memory repo, real webhook-signature verification
npm run typecheck   # tsc --noEmit over src, test and scripts
```

`node scripts/make-exif-fixture.mjs` regenerates `test/fixtures/proof-gps.jpg`.
