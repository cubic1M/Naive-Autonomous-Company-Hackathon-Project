# money-verification

Operis's money and verification layer: it holds the customer's card (Stripe Checkout, manual capture), verifies the worker's proof, captures the charge, and pays the worker 75% through Stripe Connect Express. Operis keeps 25%; the minimum job is $20; a $60 job pays the worker $45 and Operis $15. Workers connect a bank account once, on their first payout. Payouts and refunds over $150 are approved by the CEO agent (`release_payout_large` / `refund_large` with `approved_by`); a human (`ask_operator`) is needed only for legal threats, safety issues, or anything above the proposed $1,000 hard ceiling. Chargebacks are tracked for the Disputes agent. Verification strictness scales with the job (**three tiers**, below): a job under $50 is approved by the agents on device GPS and device time, a job over $150 or with a certification needs two photos, EXIF capture times, a verified Stripe Identity and a 0.90 vision score.

ESM, strict TypeScript, Node 22, vitest. Every external call goes through an injected client (a `StripeClient` subset and a `Repo`); nothing in this package reads `process.env` except `envFromProcess()`. Owner: Cameron. Edwin owns the shared `jobs` / `workers` / `proofs` tables and the MCP server that registers the tools below.

**Status (Sat Nov 7):** all code is exercised by the vitest suite (`npm test`) against a fake Stripe client and an in-memory repo, with real webhook-signature verification. It has **not yet been run against a live Stripe test account or a real Postgres**; the Stripe CLI walkthrough below is that first run.

## Layout

| Module | Exports |
|---|---|
| `src/pricing.ts` | `quote(priceCents, payoutCapCents?)` → `{ priceCents, workerPayCents, feeCents, requiresApproval }`; `quoteFromBudgetUsd(budgetUsd)`. Fee = 25% of the price rounded half-up, worker = remainder, minimum 2000 cents. |
| `src/escrow.ts` | `createEscrow(deps, job)` → `{ url, escrow }` (Checkout, `capture_method: manual`, `transfer_group: job:<id>`, idempotency `escrow:<jobId>`, rolling-24h `DAILY_ESCROW_CAP_CENTS`); `markAuthorized`, `captureEscrow`, `releaseEscrow`, `markReleased`, `refund`, `markRefunded`, `expireStaleEscrows(deps, now)` (7-day authorization TTL). |
| `src/payouts.ts` | `payWorker(deps, jobId, { allowLarge?, accountReady? })` → `{ status: 'paid', transferId, amountCents, transferred }` \| `{ status: 'pending_onboarding', accountId, onboardingUrl, amountCents }`; `createConnectAccount`, `createOnboardingLink`, `isPayoutReady`, `completePendingPayoutsForWorker(deps, workerId)`. |
| `src/settle.ts` | `settleApprovedJob(deps, jobId)` → `{ chargeId, payout }`: approved review → capture → payout, fully idempotent. |
| `src/ledger.ts` | `record(repo, { jobId, kind, amountCents, idempotencyKey, stripeRef })`, `pnl(repo, { from, to })`, `sumKind`. Kinds: `escrow_hold`, `escrow_capture`, `escrow_release`, `payout`, `fee`, `refund`, `stripe_cost`, `kyc_cost`, `dispute_loss`. |
| `src/webhooks/stripe.ts` | `handleStripeWebhook(deps, Request)` → `Response`; `createStripeWebhookHandler(deps)`; `handleStripeEvent(deps, event)`. Events: `checkout.session.completed`, `payment_intent.canceled`, `charge.refunded`, `refund.created`, `refund.updated`, `account.updated`, `charge.dispute.*`, `identity.verification_session.verified` / `.requires_input` / `.canceled`. |
| `src/disputes.ts` | `recordDisputeEvent`, `getDisputeBundle`, `submitDisputeEvidence(deps, disputeId, evidence, { submit = false })`. |
| `src/proof/profile.ts` | `verificationProfile(job)` → `{ tier, confidenceThreshold, minPhotos, exifTimePolicy, identityRequired, certificationRequired, notes }`; `describeProfile`, `profileData`, `TIER_RULES`, `budgetTier`. See "Verification tiers". |
| `src/proof/exif.ts`, `checks.ts`, `vision.ts`, `decide.ts` | `readExif` / `fetchMedia`; `runChecks(deps, job, proof, profile?)` (completeness against the tier's photo minimum, geofence, time window under the tier's EXIF policy, reuse); `VisionScorer` + `openAiCompatibleScorer` + `scorerFromEnv(env)`; `reviewProof(deps, proofId)`, `approveProof`, `escalateProof`, `rejectProof` (both refused once the proof is approved), `recordFounderDecision(deps, { jobId, decision, note })` (the founder console's decision on the latest proof: reviewer `founder`, override, identity gate waived and noted, geofence/reuse still refused). Decision: **rejected** on a geofence or media-reuse failure; **approved** only when every check passes and vision confidence ≥ the tier's threshold (0.80 / 0.85 / 0.90) with every must-show item found; otherwise **escalated**. On a tier-2 job an `identity` check escalates any proof from a worker without a verified identity. Video without a frame extractor escalates. |
| `src/certs/notary.ts`, `names.ts` | `parseNotaryListing`, `importNotaryListing`, `verifyNotary(deps, { workerId, commissionNumber, name, jobDate })` → `verified` \| `needs_review` (partial name match) \| `failed` (unknown, expired, or name mismatch). The name compared is the worker's verified Stripe Identity name when one is on file (`nameSource: 'verified_identity'`; a differing typed name is flagged), else the typed name. |
| `src/identity.ts` | `startIdentityVerification(deps, workerId)` → `{ workerId, url, status, sessionId }` (Stripe Identity document session with a matching selfie; `url: null` when already verified); `recordIdentityVerified` / `recordIdentityRequiresInput` / `recordIdentityCanceled` (the webhooks); `verifiedIdentityName(row)`. |
| `src/eligibility.ts` | `checkEligibility(deps, { workerId, jobId })` → `{ eligible, reasons, tier }`; on a tier-2 job a worker without a verified identity is not eligible (`identity_not_verified`) under `IDENTITY_GATE=enforce`; under `log` the reason is listed as not enforced and the worker stays eligible. |
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
| `refund` | `{ job_id, reason, amount_cents?, request_id }` (`request_id` required here: reuse it to retry, new one for a second refund) | `{ job_id, status: 'refunded' \| 'partially_refunded', amount_cents, refunded_total_cents }` | allow; code caps the job's cumulative refunds at $150 (`requires_approval` once the running total would exceed it); partial via `amount_cents`. Ledger lines are keyed from Stripe's refund (`request_id` in its metadata, else the refund id), the same key the `refund.created` webhook derives, so the tool and the webhook never count a refund twice |
| `refund_large` | `{ job_id, reason, amount_cents?, request_id, approved_by, approval_note? }` | same as `refund` | allow, granted by Naïve to the CEO agent only. `approved_by` is a free-text label: nothing here checks it or stores it (not in the ledger, not in Stripe metadata); it survives only in tool-call logs |
| `release_payout` | `{ job_id }` | `{ status: 'paid', transfer_id, worker_pay_cents, fee_cents, transferred }` or `{ status: 'pending_onboarding', onboarding_url, worker_pay_cents }` | allow; refuses over $150 with `requires_approval` |
| `release_payout_large` | `{ job_id, approved_by, approval_note? }` | same as `release_payout` | allow, CEO agent only; `approved_by` is a label, as for `refund_large` |
| `settle_job` | `{ job_id }` | `{ job_id, charge_id, payout }` | allow |
| `ledger` | `{ from?, to? }` | `{ fees_cents, payouts_cents, refunds_cents, costs_cents, gross_margin_cents, jobs_paid }` | allow |
| `get_proof_review` | `{ job_id }` or `{ proof_id }` | review `{ proof_id, job_id, decision, confidence, checks[], reviewer, created_at }` or `null`; each check is `{ name, status, pass, detail, data? }` and the `profile` check's `data.tier` is the tier that applied | allow |
| `approve_proof` | `{ job_id, proof_id, notes, reviewer?, override? }` | `{ job_id, proof_id, decision: 'approved' }` | allow; geofence/reuse failures can never be approved; a stored `completeness` or `time` failure (`incomplete`, `outside_time_window`) and a confidence under the tier's threshold (0.80 / 0.85 / 0.90, `below_threshold`) need `override`; under `IDENTITY_GATE=enforce` a tier-2 worker without a verified identity cannot be approved even with `override` (`identity_unverified`, checked live at approval time) |
| `escalate` | `{ job_id, proof_id, reason }` | `{ job_id, proof_id, decision: 'escalated' }` | allow |
| `verify_notary` | `{ worker_id, commission_number, name, job_date }` | `{ worker_id, status, reasons, commission_expires, name_source }` | allow; `name_source` is `verified_identity` when the name on the worker's verified ID was compared, else `typed`; a verified ID without a name (its fetch failed at the webhook and the one refetch here failed too) adds the reason `id_name_unavailable` |
| `verify_identity` | `{ worker_id }` | `{ worker_id, url, status, session_id }` | allow. Starts a Stripe Identity session (government ID plus a matching selfie) and returns the hosted URL to send the worker to; `url: null, status: 'verified'` when the identity is already on file. Each call is a new attempt (idempotency key `identity:<worker_id>:<n>`) until a webhook settles it |
| `check_eligibility` | `{ worker_id, job_id }` | `{ eligible, reasons, tier }` | allow; `tier` is the job's verification tier, `identity_not_verified` the tier-2 reason |
| `get_dispute` | `{ dispute_id }` | `{ dispute, job, proof_review, ledger }` | allow |
| `submit_dispute_evidence` | `{ dispute_id, evidence, submit = false }` | `{ dispute_id, status, submitted }` | allow. Naïve permissions are per tool, so `submit: true` cannot be gated apart from drafting; the code does not compare the dispute amount to any limit, so "Disputes submits up to $150, the CEO above" is a prompt rule only |

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

## Verification tiers

Strictness scales with what is at stake, so the agents close cheap jobs on their own and the expensive checks go where a wrong approval costs real money or a licence. `verificationProfile(job)` (`src/proof/profile.ts`) derives the tier; every automated review records it as its first check (`profile`, with the rules in its `data`), so `check_proof` evidence and `get_proof_review` show which bar applied.

| Tier | When | Photos | Capture time | Vision confidence | Identity |
|---|---|---|---|---|---|
| 0 | budget under $50, no certification | ≥ 1 | EXIF when present; otherwise the proof's device `captured_at` counts (the device GPS still has to be inside the fence) | ≥ 0.80 | not required |
| 1 | $50 to $150 | ≥ 1 | EXIF required; a missing EXIF time is a review flag (the rule before tiers) | ≥ 0.85 | not required |
| 2 | over $150, or any `certification_required` / `task_type: notarization` | ≥ 2 | EXIF required | ≥ 0.90 | verified Stripe Identity required under `IDENTITY_GATE=enforce`: a proof from a worker without one escalates, never approves. The default `log` records the check without blocking |

How the tier composes:

1. The budget picks the tier (table above).
2. `jobs.risk_class` (`low` / `standard` / `high`) overrides the budget tier; an unknown value is ignored and noted.
3. A certification (a notary commission or anything else in `certification_required`) forces tier 2, whatever the budget or risk class. A placeholder that means none (`none`, `no`, `n/a`, `na`, `nil`, `null`, `false`, `not required`, `not applicable`, `-`, any case) or a blank value is no certification: it is ignored and noted, and it does not make the job a notarization either.
4. `jobs.required_tier` is not a verification input: it is the minimum worker tier `check_eligibility` requires (`tier_too_low`). Raise or lower verification with `risk_class`.
5. The customer's own proof requirement always applies on top: `photos.min` composes with the tier minimum by max; `must_show`, `geofence_m` and `fields` are checked as before. A requirement that asks for `video` or `files` and no `photos` has no tier photo minimum (`ProofSchema.photos.requested` is false), and such a proof always goes to a human today: no frame extractor is configured, and vision has no image to score.

Geofence and media reuse stay hard failures at every tier (**rejected**, never approvable). Anything else that is not a pass **escalates** with the evidence. `approve_proof` refuses what the review recorded as a failure: geofence and reuse always; `completeness` (too few photos, missing fields) and `time` (a capture time outside the window) unless `override`, like a confidence under the tier's threshold. `needs_review` flags (no EXIF time, a `must_show` item not found, no GPS) are the reviewer's call. A tier-2 approval re-checks the identity live and records the live check in place of the stored one, so a worker who verifies after an escalation can be approved on the next `approve_proof` call. `check_proof` re-runs the automated review (and approves on its own once everything passes) only while the review on record is the automated one (reviewer `auto`); after an agent's escalate or a founder's decision it returns that review as is. `check_eligibility` returns the tier and, on a tier-2 job, lists `identity_not_verified` for a worker without a verified identity (a refusal under `IDENTITY_GATE=enforce`, advisory under `log`), so the job page can send the worker to the identity step before they accept.

`risk_class` is read from the `jobs` row when present; `contracts/schema.sql` has no such column yet, so today the tier comes from the budget and the certification alone.

### Identity flow (Stripe Identity)

1. The job page (or an agent) calls `verify_identity { worker_id }`; `createIdentityLink(workerId)` from `services/verify` is the same thing for a `POST /v1/worker/identity` route. The package creates a Stripe Identity VerificationSession (`type: document`, `require_matching_selfie: true`, `metadata.worker_id`, `return_url` `<PUBLIC_BASE_URL>/join/<workerId>/identity/done`, idempotency key `identity:<workerId>:<attempt>`), upserts `worker_verifications` (`kind: identity`, `status: pending`, `provider_ref` = session id, `details.attempts`) and returns the hosted `url`. The URL is single-use and short-lived, so it is never stored; a second call while pending is a new attempt; an already verified worker gets `url: null, status: 'verified'` and no Stripe call.
2. The worker photographs an ID and takes a selfie on Stripe's page and comes back to the return URL. The outcome arrives by webhook:
   - `identity.verification_session.verified` → `status: verified`, `verified_at`, `details.first_name` / `last_name` (from `verified_outputs`, fetched with one `retrieve(id, { expand: ['verified_outputs'] })` because the webhook payload omits them; a failed fetch keeps the verification with null names and `details.verified_outputs_error`, and `verify_notary` refetches once and patches the row), `details.type`, `details.last_verification_report`; fires `onWorkerVerified(workerId, 'verified')`.
   - `identity.verification_session.requires_input` with `last_error` → `status: needs_review`, `details.last_error` `{ code, reason }`; fires `onWorkerVerified(workerId, 'needs_review')`. Without `last_error` the session is simply still open: nothing changes.
   - `identity.verification_session.canceled` → `status: failed`; fires `onWorkerVerified(workerId, 'failed')`. The worker can start again (attempt 2).
   A verified identity is never downgraded by a later event from an older session; redeliveries are dropped by the event-id dedupe, and a second `verified` event changes nothing.
3. From then on tier-2 proofs can be approved, `check_eligibility` passes the identity gate, and `verify_notary` compares the name on the ID (not the typed one) with the commission.

Stripe charges per completed verification, not per session. The row keeps only the names and ids above, never the document images; the proof review records only that an identity is verified.

## Agent-payable escrow (card on file, `payment_method` in the call)

The Checkout link presumes a human with a browser and a card. An autonomous customer has neither, so `createEscrow(deps, job, { paymentMethod? })` can place the hold directly and returns `{ url, escrow, funded, fallback_reason? }`:

| Instrument | What happens | `request_human` answer |
|---|---|---|
| `payment.payment_method` passed in the call (a Stripe PaymentMethod id, `pm_...`) | PaymentIntent created and confirmed off-session, manual capture; escrows row inserted `authorized` (7-day expiry); `escrow_hold` line; `onJobFunded` fires | `status: held`, `escrow_url: null`, funded in the same call |
| none passed, the customer has a card on file (`customers.default_payment_method_id`, charged on `customers.stripe_customer_id`) | same | same |
| neither, or the instrument is declined / needs authentication / is unknown | the Checkout session as before (`fallback_reason`: `card_declined`, `authentication_required`, `expired_card`, `invalid_payment_method`, ...); the webhook funds the job when it is paid | `status: requested`, `escrow_url` to pay |

Any Stripe error that is not about the card propagates: no silent fallback, no row written. The daily cap applies before any Stripe call on both paths. Idempotency: Stripe binds a key to one endpoint and replays the first answer (a decline included), so the PaymentIntent uses `escrow:<jobId>:pi` and the Checkout session keeps `escrow:<jobId>`; a retry after a direct hold returns the same funded escrow without a Stripe call; a pending Checkout escrow returns its session again and is never upgraded to a direct hold; the ledger key is `escrow_hold:<jobId>` either way. The package never moves the job: `services/payments` `createHold(jobId, { paymentMethod? })` returns `{ escrow_url, funded, next_step, fallback_reason? }` and `request_human` transitions to `held` when `funded` (hooks do the same for the internal `create_escrow` tool, whose `checkout_url` is now nullable with a `funded` flag).

**Card on file.** `createPaymentSetupLink(deps, customerId)` (shim: `createPaymentSetupLink(customerId)` for a `POST /v1/customers/payment-setup` route under the customer's key) creates the Stripe Customer on first use (`customer:<id>`, stored in `customers.stripe_customer_id`, with the row's email and name) and a setup-mode Checkout session (`payment_method_types: card`, key `payment_setup:<id>:<current pm or none>` so a retry gets the same session and a replacement card a new one; return URL `<PUBLIC_BASE_URL>/customers/<id>/payment/done`). A human opens it once. `checkout.session.completed` with `mode: setup` retrieves the SetupIntent (the event only carries its id) and stores its `payment_method` in `customers.default_payment_method_id`; from then on every `createEscrow` for that customer funds directly.

**`payment_intent.amount_capturable_updated`** (add it to the webhook endpoint) marks the escrow authorized and fires `onJobFunded` when the escrow was still pending (a Checkout hold: it usually lands before `checkout.session.completed`, which then adds no second hook) or when the escrow is authorized but the job is still `requested` (belt and braces for a `request_human` whose own transition failed). A PaymentIntent of ours whose escrow row is not written yet answers 500 so Stripe retries; one that is not the escrow's is reported unhandled.

Shared Payment Tokens from the Agentic Commerce Protocol are not PaymentMethod ids (they go in `payment_method_data.shared_payment_granted_token` under a preview API version) and are not accepted yet.

## Contract adapters (`contracts/tools.ts`)

`src/contract-tools.ts` (`createContractTools(deps)`) exposes the same code under the exact names and shapes in `contracts/tools.ts`, so Edwin's registry can swap each mock for the real tool without reshaping anything: `check_proof`, `approve_proof`, `escalate`, `capture_payment`, `payout`, `refund`, `ledger`. USD numbers at that boundary, cents inside.

- `check_proof` runs the automated review on the job's latest proof (persisting a `proof_reviews` row with reviewer `auto` and firing `onProofDecision`) and returns the evidence: `gps_distance_m`, `timestamp_ok`, `checklist`, `overall_score`, `flags`, plus the `decision`, the `tier` and the `profile` (additive). A review a human already made is returned as is, never overwritten.
- `approve_proof` answers `{ error: 'outside_geofence' | 'below_threshold' | 'reused_media' | 'identity_unverified' | 'incomplete' | 'outside_time_window' }` instead of throwing. The contract cannot pass `override`, so `incomplete` and `outside_time_window` are refusals here. The contract lists two codes; `services/verify` maps `reused_media` to `outside_geofence` and the other three to `below_threshold`.
- `payout` answers `{ error: 'needs_bank_setup', onboarding_url }` or `{ error: 'over_limit' }`.
- `refund` accepts `amount_cents` for a partial refund and answers `partial: true` plus `refunded_total_usd`, **when `createContractTools` is called directly (as the tests do). Through Edwin's MCP server today the partial is impossible**: `apps/api/src/mcp/schemas.ts` declares only `job_id` and `reason` for `refund`, and zod drops the rest, so the call becomes a full refund. Ask for Edwin below. Over the cap (a job's refunds adding up past $150) it throws `RequiresApprovalError` (code `requires_approval`); `serveMcp` shows the agent only `Error: <message>`, and the message reads `refund of N cents exceeds the cap of 15000 cents; ask the CEO agent to approve it with refund_large`. On a job whose card was only held (`pending` / `authorized`) it releases the whole hold and ignores `amount_cents`, reporting `released_hold: true`. The contract's `refund` has no `request_id`: when absent the adapter derives one from job, reason and amount, so a blind retry replays instead of refunding twice.
- `ledger.revenue_usd` is everything captured from customers (payouts + fees); `fees_usd` is our share before costs.

## Plugging into `apps/api` (Edwin's registry)

`services/payments/index.ts` and `services/verify/index.ts` export real `ToolImpl`s (contracts/runtime.ts) backed by this package, so `apps/api/src/tools/registry.ts` picks them over the mocks with no other change: `check_proof`, `approve_proof`, `escalate`, `capture_payment`, `payout`, `refund`, `ledger`. `src/api-context.ts` does the binding: `depsFromApiContext(ctx)` builds the deps from the API's postgres.js client and `process.env`, and turns the hooks into `ctx.transition()` calls (`held`, `approved` / `escalated` / `rejected`, `paid`, and `refunded` for any hold release or refund) while mirroring `proofs.status / verifier_score / verifier_notes / reviewed_by` and `workers.jobs_done`, as the mocks did. A refused transition is logged, never thrown.

- `createHold(jobId, { paymentMethod? })` (exported from `services/payments`) is what `request_human` calls through `registry.createHold`; `createPaymentSetupLink(customerId)` is for a `POST /v1/customers/payment-setup` route (card on file); `createPayoutLink(workerId)` is what `POST /v1/worker/payout-setup` calls for Dora's `/payout` screen; `createIdentityLink(workerId)` (a named export of `services/verify`, read with `import * as verify` like `createPayoutLink` since PR #15) is for a `POST /v1/worker/identity` route: the job page shows it before proof upload on a tier-2 job. All use a process-wide Neon pool from `DATABASE_URL` and need `STRIPE_SECRET_KEY`.
- **Merging the branch flips the registry from mocks to these real tools at once.** Before that: run the migration on Neon, set the env vars on Vercel, and add `npm ci` for `services/money-verification` to the install step. Otherwise merge with `MOCK_PAYMENTS=true` and `MOCK_TOOLS=check_proof,approve_proof,escalate,capture_payment,payout,refund,ledger` set, and remove them when ready.
- `stripeWebhook(req, ctx)` (same file) is a drop-in body for `apps/api/src/app/webhooks/stripe/route.ts`: it verifies over the raw body, dedupes on event id, handles every event listed under Stripe dashboard setup and moves the job to `held` with `stripe_payment_intent`, exactly as the current route does, plus the rest.
- The shims import `../money-verification/src/index`, whose dependencies live in `services/money-verification/node_modules`: the install step must run `npm ci` there (as for `services/outreach`). They typecheck under bundler resolution; they have not yet been compiled inside the Next app.

## Hooks (Edwin wires these)

This package never writes the `jobs` table or talks to Naïve. It fires these hooks; the API moves the job state and wakes the right agent.

| Hook | Fired when | Expected reaction |
|---|---|---|
| `onJobFunded(jobId)` | the card was authorized: `checkout.session.completed`, `payment_intent.amount_capturable_updated`, or a direct hold in `createEscrow` | job → `held`; wake CEO (a repeat for an already held job is refused and logged) |
| `onProofDecision(jobId, proofId, decision)` | a review was written (automated or manual) | job → `approved` / `escalated` / `rejected`; wake Finance on approved |
| `onWorkerPaid(jobId, workerId, transferId)` | the worker transfer was created | job → `paid`; customer callback |
| `onWorkerPayoutReady(workerId)` | Connect onboarding finished (`account.updated`) | informational |
| `onWorkerVerified(workerId, status)` | Stripe Identity webhook: `verified`, `needs_review` (a check failed, retry) or `failed` (canceled) | informational; `api-context.ts` logs it. The job page re-reads `check_eligibility` on its next load |
| `onEscrowReleased(jobId, 'released' \| 'refunded')` | hold released or charge refunded | `src/api-context.ts` asks for job → `refunded` in both cases (`contracts/states.ts` allows that only from `rejected` / `expired`; from `approved` / `paid` the refusal is logged and the job state stays, though the money is back) |
| `onDisputeOpened(disputeId, jobId \| null)` | a chargeback was opened | intended: wake the Disputes agent. Today `api-context.ts` only logs; there is no Disputes member in `agents/agents.json`, so nothing wakes |

Hooks are awaited. A throwing hook does not roll back the money write that preceded it. Make them idempotent: webhooks retry.

## Environment variables

| Variable | Notes |
|---|---|
| `STRIPE_SECRET_KEY` | Edwin's server constructs the Stripe client; this package never reads it. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret from the dashboard endpoint or `stripe listen`. |
| `PUBLIC_BASE_URL` | No trailing slash. Checkout success/cancel, Connect return and Stripe Identity return URLs (`/join/<workerId>/identity/done`). |
| `DAILY_ESCROW_CAP_CENTS` | Rolling 24h cap on new holds. Default `200000`. Alias `DAILY_HOLD_CAP_CENTS`. |
| `PAYOUT_CAP_CENTS` | Per-job payout or refund above this needs CEO agent approval. Default `15000`. |
| `IDENTITY_GATE` | `enforce` or `log`, default `log`. Under `log` the tier-2 identity check is recorded in the review (`data.enforced: false`, `data.verified` true or false) and `check_eligibility` lists `identity_not_verified … not enforced` without making the worker ineligible, but it blocks neither `check_proof` nor `approve_proof`; tier 2 keeps 2 photos, EXIF and 0.90. Set `enforce` once the job page sends tier-2 workers through Stripe Identity before proof upload: Edwin's `POST /v1/worker/identity` exists, but nothing calls it yet (that is Dora's job-page step). Any other value fails at startup. |
| `VERIFIER_BASE_URL`, `VERIFIER_API_KEY`, `VERIFIER_MODEL` | OpenAI-compatible vision endpoint via Naïve's model router. When any is missing, `scorerFromEnv` returns `null` and every proof escalates. |
| `DATABASE_URL` | Used only by `scripts/import-notaries.ts`. |

See `.env.example`. Never commit real values.

## Database

`migrations/0001_money_verification.sql` is idempotent plain SQL (`create table if not exists`, `drop constraint if exists` + `add constraint`) and creates only this package's tables: `escrows`, `ledger`, `stripe_events`, `payouts`, `proof_reviews`, `worker_verifications`, `notary_registry`, `disputes`. It never creates or alters `jobs` / `workers` / `proofs`. `migrations/0002_customer_payment.sql` adds `customers.stripe_customer_id` and `customers.default_payment_method_id` (`alter table ... add column if not exists`), the card on file; `PostgresRepo` finds a job's card on file with `select c.* from jobs j join customers c on c.id = j.customer_id`, so until the migration has run the code behaves as "no card on file" instead of failing; the `Job` view and `mapJob` are unchanged. The writes to teammates' tables are `workers.stripe_connect_account` and those two columns.

Run by hand, after Edwin has reviewed it:

```sh
psql "$DATABASE_URL" -f services/money-verification/migrations/0001_money_verification.sql
psql "$DATABASE_URL" -f services/money-verification/migrations/0002_customer_payment.sql
```

(or add both to `MIGRATIONS` in `scripts/migrate.ts`; the first is already there.)

No `drizzle-kit push`.

**Shared `ledger` table.** `contracts/schema.sql` defines `ledger (kind, amount_usd, ref)` and Edwin's and Andrew's code write cost rows (`sms_cost`, `scrape_cost`) into it. Our migration is a superset that works whichever file runs first: it creates the table with both column sets, or adds ours (`amount_cents`, `currency`, `stripe_ref`, `idempotency_key`, a unique index on the key) to the existing one. Every row we write carries `amount_cents` and `amount_usd = cents / 100`; rows written in USD only are read back as cents. `pnl()` counts `sms_cost` and `scrape_cost` as costs.

**Reading the shared `jobs` / `proofs` tables.** `PostgresRepo` reads the contract's columns as they are: `budget_usd` / `fee_usd` / `worker_pay_usd` become integer cents (fee and worker pay are derived with the 25% split when null), `proof_requirement` becomes `ProofSchema`, `certification_required` containing "notar" becomes `task_type: 'notarization'`, and media rows `{ url, kind, exif }` become `{ url, sha256: '', mime }` with the mime guessed from `kind` or the extension.

## Asks for Edwin (shared schema and API)

- Founder console: `POST /v1/admin/escalations/[jobId]` approves by writing `proofs` and calling `transition()` only, so payout and settle, which read `proof_reviews`, refuse after the charge is captured. Call `recordFounderDecision(jobId, status, note)` from `@services/verify` before the `update proofs` line, and answer 409 on its `invalid_state` errors (a geofence or reused-media failure, or rejecting an approved proof).
- `jobs.accepted_at timestamptz`, set when the worker clicks Yes. Without it the capture-time check cannot bound the window and every proof escalates to a human.
- `proofs.media` rows should carry `sha256` (hex of the file bytes) and `mime` next to `url` / `kind` / `exif` (Dora's upload endpoint can compute both). Without `sha256` the media-reuse check is skipped; without `mime` it is guessed.
- One `ledger` definition in the repo: ours is a superset of the contract's. Proposal: replace the `ledger` block in `contracts/schema.sql` with the one in our migration, or drop it and let our migration create the table.
- **Partial refund is broken through the server.** Declare `amount_cents` (positive integer cents, optional) and preferably `request_id` on `refund` in `apps/api/src/mcp/schemas.ts` and in the `refund` ToolSpec of `contracts/tools.ts` (`createContractTools` already accepts both); until then a requested partial refund is a full refund.
- Register `refund_large` and `release_payout_large` for the CEO agent (permission allow); today they are in no registry, schema list or `agents.json`, so nothing above $150 can be executed by an agent. They need the `Tools` / `TOOL_REGISTRY` entries, an `apps/api/src/mcp/schemas.ts` entry and an adapter (this package has none; `createTools(...).refund_large` has the package shape, with `approved_by` and `request_id`). `approved_by` is only a label; the real control is that Naïve grants these tools to the CEO alone.
- Flip `operis.refund` from `ask` to `allow` for Finance, **CEO** and Disputes (a CEO-run refund under $150 waits for a human otherwise). Update the Finance and CEO prompts that say "refunds always need founder approval", "you never pay workers yourself" and "if over_limit, a founder must approve": over $150 the CEO agent approves and executes, and a human (`ask_operator`) only for legal threats, safety issues, or above the proposed $1,000 hard ceiling, which no code enforces. Finance needs a way to reach the CEO (`send_to_agent`) on `over_limit`.
- Make `serveMcp` return `describeToolError(err)` (the code as well as the message), so an agent sees the stable code `requires_approval` / `idempotency_conflict`, not only the message text.
- Add a Disputes agent (member in `agents.json`, `AgentRole`, `Agent`, wake on dispute) or make the CEO its owner, and register `get_proof_review`, `get_dispute`, `submit_dispute_evidence` for it.
- Verification tiers: `POST /v1/worker/identity` (`createIdentityLink`) and the `verification_tier` / `identity_required` / `identity_verified` fields on `GET /v1/worker/jobs/[token]` are in (241ae39). Left: the identity step on the job page before proof upload when `identity_required` is true and `identity_verified` false (then Cameron sets `IDENTITY_GATE=enforce`); add `identity.verification_session.verified`, `identity.verification_session.requires_input` and `identity.verification_session.canceled` to the webhook endpoint; optionally add `jobs.risk_class text` so Ops can override the budget tier (not `jobs.required_tier`: that is the worker-tier gate in `check_eligibility`, and with no `workers.tier` column a value above 0 refuses every worker). The Verifier prompt already trusts `check_proof`'s `decision` (241ae39); the bar it should name is `profile.confidence_threshold` (0.80 / 0.85 / 0.90), a field of `check_proof`'s output, not one of its `flags` (a passing check is never a flag). `escalate` on an approved proof answers `error: 'already_approved'` (#26).
- Agent-payable escrow: `payment?: { payment_method }` on `request_human` in `contracts/tools.ts` and `apps/api/src/mcp/schemas.ts`; `createHold(job.id, { paymentMethod })` plus `transition(job.id, 'held')` and `status: 'held'` when `funded`; a `POST /v1/customers/payment-setup` route calling `createPaymentSetupLink(customer.id)`; `0002_customer_payment.sql` in `scripts/migrate.ts`; the guide text for `payment` and the setup route (paste-ready snippets in the PR).
- Done: `apps/api/src/app/webhooks/stripe/route.ts` delegates to `stripeWebhook` from `@services/payments`, and the root `workspaces` include `services/money-verification`, so the root install covers it. The seven contract tools are already exported from `services/payments` and `services/verify`; the rest (`create_escrow`, `release_escrow`, `refund_large`, `release_payout_large`, `settle_job`, `get_proof_review`, `verify_notary`, `verify_identity`, `check_eligibility`, `get_dispute`, `submit_dispute_evidence`) are available through `createTools(depsFromApiContext(ctx))` when the registry grows.

## Stripe dashboard setup (test mode)

1. Enable Checkout.
2. Enable Connect with Express accounts (Settings → Connect). Set the platform name and branding: workers see the onboarding page.
3. Enable Identity (required for tier-2 jobs: over $150 or with a certification). Document checks with a matching selfie; no dashboard template is needed, the session is configured by the API call.
4. Add a webhook endpoint `https://<app>/webhooks/stripe` with these events: `checkout.session.completed`, `payment_intent.amount_capturable_updated`, `payment_intent.canceled`, `charge.refunded`, `refund.created`, `refund.updated`, `account.updated`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `identity.verification_session.verified`, `identity.verification_session.requires_input`, `identity.verification_session.canceled`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`. `refund.created` is what puts dashboard or CLI refunds in the ledger; `charge.refunded` only reconciles the escrow status; `payment_intent.amount_capturable_updated` is the belt-and-braces funding signal for direct holds (not on the current `operis-api` endpoint yet).
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

`stripe trigger checkout.session.completed` sends a synthetic event with no matching escrow, so the handler answers 200 with `handled: false`; use it only to check signatures and routing. `stripe trigger charge.dispute.created` exercises the disputes path the same way, and `stripe trigger identity.verification_session.verified` a session without our `metadata.worker_id` (also `handled: false`). For a real identity run, call `verify_identity` for a worker, open the URL and use Stripe's test documents.

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
