# Operis build plan

Setup steps, environment variables, the verification and payout contract, certification checks, build gates, the demo runbook and what is out of scope for the YC × Naïve Autonomous Companies Hackathon (Nov 7–8, 2026, San Francisco). [README.md](../README.md) is the team contract and wins over this file. Read with [docs/FLOW.md](FLOW.md) (the job flow and folder ownership), [docs/plans/edwin.md](plans/edwin.md) (API, database, agents, milestone checks) and [services/outreach/README.md](../services/outreach/README.md) (scraping and outreach).

## 1. Setup steps

1. Naïve CLI: `npm i -g @usenaive-sdk/cli`, then `naive login`, then `naive whoami` (should show our org). Subscribe to a paid plan: `naive plan subscribe --plan pro`. LLM routing requires a paid plan.
2. Stripe: test mode, with Checkout, Connect (Express accounts) and Identity enabled in the dashboard. Add a webhook endpoint at `https://<app>/webhooks/stripe` subscribed to `checkout.session.completed`, `payment_intent.canceled`, `charge.refunded`, `account.updated`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Create a Neon project (Postgres) and a Vercel project for the API and web app. Run `contracts/schema.sql`, then the owners' migrations (`services/outreach/migrations`, `services/money-verification/migrations`), by hand.
4. SMS: the README lists Twilio; Edwin's and Andrew's plans use **Mobilerun** as the primary SMS channel with Monid AgentLine as the fallback (see `docs/plans/edwin.md` §2). If we fall back to a Twilio trial, it only texts verified numbers: verify every demo worker's phone in the Twilio console. A2P 10DLC registration comes after the hackathon.
5. Naïve agent config pattern:
   `naive agent create --name <n> --model <m> --harness pi --budget-usd <x> --max-task-usd <y> --budget-period day --system "$(cat agents/prompts/<n>.md)"`
6. Attach the MCP server per agent with the SDK:
   `naive.agents.update(id, { expected_version, mcp_servers: [{ type: "url", name: "operis", url: "https://<app>/mcp" }], tools: { default_config: { permission: "deny" }, configs: { "operis.<tool>": { enabled: true, permission: "allow" | "ask" } } } })`
   MCP tools default to `ask`. Every tool that must run without a human needs an explicit `allow`. Auth comes from a Naïve vault `static_bearer` credential, never an inline `Authorization` header.
7. Team: `naive team set <ceo_id> --member <name>@<version> ... --board`. Board statuses: `todo`, `doing`, `blocked`, `done`.

## 2. Environment variables

| Variable | Owner | Purpose |
|---|---|---|
| `DATABASE_URL` | Edwin | Postgres connection (Neon, pooled) |
| `STRIPE_SECRET_KEY` | Cameron creates, Edwin stores | Stripe API calls |
| `STRIPE_WEBHOOK_SECRET` | Cameron creates, Edwin stores | Webhook signature verification |
| `PUBLIC_BASE_URL` | Edwin | Public app URL, no trailing slash (Checkout and Connect return URLs) |
| `NAIVE_API_KEY`, `NAIVE_AGENT_*`, `INTERNAL_MCP_KEY` | Edwin | Naïve SDK, agent ids, internal MCP auth (full list in `docs/plans/edwin.md` §3) |
| `MOBILERUN_*`, `MONID_API_KEY` | Edwin / Andrew | SMS and people search (names in `docs/plans/edwin.md` §3 and `services/outreach/src/env.ts`) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Andrew | Only if we fall back to Twilio for SMS |
| `VERIFIER_BASE_URL` | Cameron | OpenAI-compatible vision endpoint via Naïve's model router |
| `VERIFIER_API_KEY` | Cameron | Auth for the verifier endpoint |
| `VERIFIER_MODEL` | Cameron | Vision-capable model id for proof review |
| `DAILY_ESCROW_CAP_CENTS` | Cameron | Rolling 24h cap on new card holds, default `200000` ($2,000); alias `DAILY_HOLD_CAP_CENTS` |
| `PAYOUT_CAP_CENTS` | Cameron | Per-job payout above this needs founder approval, default `15000` ($150) |

TODO Edwin / TODO Andrew: add whatever the API, scraper and outreach code need. Never put real values in this file or anywhere in the repo; use Vercel env vars and the Naïve vault.

## 3. Verification and payout contract

Code, exports, migration and the Stripe CLI test: [services/money-verification/README.md](../services/money-verification/README.md). Tool shapes for the agents: `contracts/tools.ts`, with contract-shaped adapters in `services/money-verification/src/contract-tools.ts`.

Job-state transitions this workstream drives (the API applies them in the hooks through `canTransition()`; this package never writes the `jobs` table):

| Job state after | Trigger | Hook Edwin wires |
|---|---|---|
| `held` | `checkout.session.completed` authorized the card | `onJobFunded(jobId)` |
| `approved` / `escalated` / `rejected` | automated or manual proof decision | `onProofDecision(jobId, proofId, decision)` |
| `paid` | worker transfer created | `onWorkerPaid(jobId, workerId, transferId)` |
| `cancelled` / `expired` / `refunded` | hold released or charge refunded | `onEscrowReleased(jobId, 'released' \| 'refunded')` |
| (no state change) | Connect onboarding finished | `onWorkerPayoutReady(workerId)` |
| (no state change) | chargeback opened | `onDisputeOpened(disputeId, jobId)` |

Each hook moves the job state and wakes the right Naïve agent (`held` → CEO, `approved` → Finance, dispute → Disputes). Hooks must be idempotent because webhooks retry. The recommended Finance step after approval is one call to `settle_job` (capture + payout, idempotent); the contract's `capture_payment` then `payout` also work.

Internal MCP tools this workstream provides, with the Naïve permission each should get: `create_escrow` (allow), `capture_escrow` / `capture_payment` (allow), `release_escrow` (allow), `refund` (**ask**), `release_payout` / `payout` (allow; refuses over $150), `release_payout_large` (**ask**), `settle_job` (allow), `ledger` (allow), `check_proof` (allow), `get_proof_review` (allow), `approve_proof` (allow), `escalate` (allow), `verify_notary` (allow), `check_eligibility` (allow), `get_dispute` (allow), `submit_dispute_evidence` (allow for drafts; `submit` defaults to false, **ask** before submitting).

Limits enforced in code, not in prompts:

- $150 payout cap per job (`requires_approval` / `over_limit`).
- Rolling $2,000/day cap on new holds.
- Geofence, default 150 m; a proof outside it is rejected and can never be approved.
- Reused media (same file hash on another job) is always rejected.
- Auto-approval needs vision confidence ≥ 0.85 with every must-show item found; anything else escalates to a human.

## 4. Certifications

When a job requires a notary:

1. Check the commission number against the California Secretary of State notary listing (imported into the `notary_registry` table with `npm run import:notaries`).
2. Confirm that the name on the commission matches the person.
3. Confirm contact through the phone or email on their public listing, never one they supplied themselves.

Partial name match → `needs_review` (a founder decides). Expired commission → `failed`. Never ask for a notary's journal.

## 5. Build gates

| When | Gate | Fallback |
|---|---|---|
| Sat 6 pm | One job end to end with a scripted approval (Edwin's M1/M2) | — |
| Sat 10 pm | Agents run the loop | One Naïve agent with every tool |
| Sun morning | Real jobs for other teams; no new features (M3) | — |
| 3 h before demos | Code freeze | — |

## 6. Demo runbook

- 0:00–0:30: evidence that autonomous companies need humans. Anthropic's Project Vend needed humans. Andon Labs' AI store could not sign its own lease.
- Live job end to end: request, outreach, acceptance, proof upload, verification, charge, payout.
- Ledger: jobs completed, payouts made, margin, one escalation and why it happened.
- Business model and honest risk.
- Rules: never debug on stage. Keep a second job in progress as backup.

## 7. Out of scope this weekend

- Background checks.
- Insurance.
- Lawyer matching (regulated).
- x402.
