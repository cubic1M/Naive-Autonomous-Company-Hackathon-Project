# Operis build plan

Setup steps, environment variables, the verification and payout contract, certification checks, build gates, the demo runbook and what is out of scope for the YC × Naïve Autonomous Companies Hackathon (Nov 7–8, 2026, San Francisco). [README.md](../README.md) is the team contract and wins over this file. Read with [docs/FLOW.md](FLOW.md) (the job flow and folder ownership), [docs/plans/edwin.md](plans/edwin.md) (API, database, agents, milestone checks) and [services/outreach/README.md](../services/outreach/README.md) (scraping and outreach).

## 1. Setup steps

1. Naïve CLI: `npm i -g @usenaive-sdk/cli`, then `naive login`, then `naive whoami` (should show our org). Subscribe to a paid plan: `naive plan subscribe --plan pro`. LLM routing requires a paid plan.
2. Stripe: test mode, with Checkout, Connect (Express accounts) and Identity enabled in the dashboard. Add a webhook endpoint at `https://<app>/webhooks/stripe` subscribed to `checkout.session.completed`, `payment_intent.canceled`, `charge.refunded`, `refund.created`, `refund.updated`, `account.updated`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` (`refund.created` is what records dashboard refunds in the ledger). Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
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
| `PAYOUT_CAP_CENTS` | Cameron | Per-job refund or payout above this needs CEO agent approval, default `15000` ($150) |

TODO Edwin / TODO Andrew: add whatever the API, scraper and outreach code need. Never put real values in this file or anywhere in the repo; use Vercel env vars and the Naïve vault.

## 3. Verification and payout contract

Code, exports, migration and the Stripe CLI test: [services/money-verification/README.md](../services/money-verification/README.md). Tool shapes for the agents: `contracts/tools.ts`, with contract-shaped adapters in `services/money-verification/src/contract-tools.ts`.

Job-state transitions this workstream drives (the API applies them in the hooks through `canTransition()`; this package never writes the `jobs` table):

| Job state after | Trigger | Hook Edwin wires |
|---|---|---|
| `held` | `checkout.session.completed` authorized the card | `onJobFunded(jobId)` |
| `approved` / `escalated` / `rejected` | automated or manual proof decision | `onProofDecision(jobId, proofId, decision)` |
| `paid` | worker transfer created | `onWorkerPaid(jobId, workerId, transferId)` |
| `refunded` (only from `rejected` / `expired`) | hold released or charge refunded | `onEscrowReleased(jobId, 'released' \| 'refunded')` |
| (no state change) | Connect onboarding finished | `onWorkerPayoutReady(workerId)` |
| (no state change) | chargeback opened | `onDisputeOpened(disputeId, jobId)`; today it only logs |

Each state hook moves the job and wakes the right Naïve agent (`held` → CEO, `approved` → Finance; `contracts/states.ts` WAKE_ON_ENTER). Hooks must be idempotent because webhooks retry.

What the code does today, which differs from what an earlier version of this table promised (`services/money-verification/src/api-context.ts`):

- `onEscrowReleased` asks for `refunded` for both `released` and `refunded`; it never asks for `cancelled` or `expired`. `contracts/states.ts` allows `refunded` only from `rejected` and `expired`, so a refund of an `approved` or `paid` job (the Disputes case) leaves the job state unchanged; the refusal is logged, not thrown. The money is refunded; `get_job` still says `paid`.
- `onDisputeOpened` only logs. There is no Disputes agent member: it is not in `agents/agents.json`, `AgentRole`, `Agent` in `contracts/tools.ts` or `WAKE_ON_ENTER`, and the team README assigns disputes to the CEO. Until that changes, `agents/prompts/disputes.md` is a playbook the CEO agent runs (it needs the Disputes tools below) and nothing wakes anyone on a chargeback. The recommended Finance step after approval is one call to `settle_job` (capture + payout, idempotent); the contract's `capture_payment` then `payout` also work.

Internal MCP tools this workstream provides (the package exports all of them; Edwin's registry serves only the seven contract tools, see §3 asks), with the Naïve permission each should get: `create_escrow` (allow), `capture_escrow` / `capture_payment` (allow), `release_escrow` (allow), `refund` (allow; the code stops a job's cumulative refunds at $150, partial via `amount_cents` in the package but not yet through Edwin's server), `refund_large` and `release_payout_large` (allow for the CEO agent only; `approved_by` is a free-text label kept in tool-call logs, not verified or stored by the package), `release_payout` / `payout` (allow; refuses over $150), `settle_job` (allow), `ledger` (allow), `check_proof` (allow), `get_proof_review` (allow), `approve_proof` (allow), `escalate` (allow), `verify_notary` (allow), `check_eligibility` (allow), `get_dispute` (allow), `submit_dispute_evidence` (allow; Naïve permissions are per tool so `submit: true` cannot be gated separately; `submit` defaults to false; the "Disputes submits up to $150, the CEO approves above" rule lives in the prompt only, the code does not compare the amount).

Limits enforced in code, not in prompts:

- $150 cap on refunds (cumulative per job) and payouts in code. The package throws `requires_approval`; the contract `payout` returns `over_limit`; the contract `refund` lets the error propagate, and Edwin's `serveMcp` shows the agent only its message (`refund of N cents exceeds the cap of 15000 cents; ask the CEO agent to approve it with refund_large`), not the code. Above the cap the CEO agent approves via the `*_large` tools.
- Rolling $2,000/day cap on new holds.
- Geofence, default 150 m; a proof outside it is rejected and can never be approved.
- Reused media (same file hash on another job) is always rejected.
- Auto-approval needs vision confidence ≥ 0.85 with every must-show item found; anything else escalates to a human.

Rules that live in prompts only, not enforced in code (so say so when relying on them):

- The proposed $1,000 hard ceiling for a human (`ask_operator`): `refund_large` and `release_payout_large` have no upper limit, only the caller's discipline. Via `request_human` it can only bite for non-money claims: a job budget is capped at $1,000 (`apps/api/src/mcp/schemas.ts`), so a refund is at most $1,000 and a worker payout at most $750.
- Disputes submits chargeback evidence only up to $150 and the CEO above; `submit_dispute_evidence` checks only that the dispute exists. Damage claims have no code or tool at all.
- `approved_by` identifies the approver only in logs; any caller holding the permission can write any value. The real control is which agents Naïve lets call the `*_large` tools.
**Policy status: proposed, not yet in force.** README.md (here and at the repo root) still says "refunds and payouts over $150 need founder approval"; the PR proposes "CEO approval over $150; a human only for legal threats, safety issues or above $1,000". `agents/prompts/disputes.md` and the text above already follow the proposal, so merge them together with the README change; until the README lands it wins, and the older wording in `docs/FLOW.md` (the `payout` and `refund` rows) and `docs/plans/edwin.md` (`ask` approvals reaching a founder) stays authoritative.

Gaps before the CEO-approval policy can run without a human (asks, not yet done):

1. **Edwin, registry:** register `refund_large` and `release_payout_large` (add to `contracts/tools.ts` `Tools` and `TOOL_REGISTRY`, `apps/api/src/mcp/schemas.ts`, `INTERNAL_TOOLS`, `agents.json` for the CEO). Today no agent has any executor above $150; Finance's `payout` stops at `over_limit`.
2. **Edwin, `refund` schema:** declare `amount_cents` (and optionally `request_id`) in `apps/api/src/mcp/schemas.ts` and the `refund` ToolSpec; zod drops undeclared keys, so a partial refund through the server is silently a full refund today.
3. **Edwin, `agents.json`:** flip `operis.refund` from `ask` to `allow` for Finance and CEO (and Disputes once it exists); until then those calls wait for a human.
4. **Edwin / Cameron, errors:** have `serveMcp` return `describeToolError(err)` (code and message) so the agent sees `requires_approval`.
5. **Prompts (not in this branch's files):** `ceo.md` and `finance.md` still say refunds need founder approval and "you never pay workers yourself"; `finance.md` says an `over_limit` payout needs a founder; Finance has no `send_to_agent` to reach the CEO.
6. **Disputes agent:** add the member and its wake path, or document the CEO as the Disputes owner.
7. **Stale code wording (Cameron):** `errors.ts` / `payouts.ts` / `disputes.ts` comments and the "payout ... human approval" message, and `webhooks/naive/route.ts` ("waiting for founder approval").

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
