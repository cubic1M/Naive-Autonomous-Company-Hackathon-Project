# Per-job liability model: design

Date: 2026-11-08. Status: draft for Cameron's review. Decisions below were made by Cameron on Nov 8 in the
coordinator session. This is a product and engineering design, not legal advice; the policy rules and fees
are drafts for counsel.

## Problem

Intake today is binary. `apps/api/src/lib/safety.ts` either rejects a job by keyword or lets Operis run it,
and Operis is then the seller of record (Stripe separate charges and transfers in
`services/money-verification`). All licensed work is rejected outright, yet outreach already sources
attorneys and notaries. Operis also holds no professional licences and no insurance, so for some jobs it
cannot legally be the party responsible for the work.

## Decisions

1. Operis holds the liability and charges for every job it legally can. It acts only as a connector where
   the law will not let a company with Operis's setup hold the liability for that job.
2. A dedicated Compliance agent, a seventh Naive agent, makes that call for each job after funding and
   before outreach.
3. Rules plus agent: code tags the clear cases and the agent cannot overrule a tag; the agent judges the
   rest against a versioned policy and cites the rule it used; when unsure it picks connector.
4. No rule for risky physical work. Operis holds those jobs and carries that risk without insurance for
   now; buying general liability cover is the first growth step after the demo.
5. Legal jobs are allowed as connector jobs, with the attorney's licence checked against the California
   State Bar's public lookup.
6. Connector pricing: the worker keeps the whole budget; the customer pays a sliding platform fee on top,
   so a large professional fee does not carry a large percentage.
7. Cameron's side builds every piece, including Edwin's files and the Naive agent setup, through PRs.

## Outcomes

| Model | Who provides the work and holds liability for it | Money |
|---|---|---|
| `operis` | Operis. The worker is Operis's independent contractor. | Customer pays the budget; worker 75%, Operis 25% (unchanged) |
| `connector` | The worker, under their own licence where one applies. Operis is the marketplace and payment agent. | L1 and L2 jobs use connector pricing: worker gets 100% of the budget and the customer pays the budget plus the platform fee. Any other connector job keeps standard pricing |
| `refuse` | Nobody. The hold is released and the customer gets the reason. | Nothing charged |

Money flows through Operis in both served models: card held at funding, charged after approved proof,
worker paid through Stripe Connect. Operis stays the seller of record on the card charge in both.

## Policy v1 (California)

The policy is data in code (`services/money-verification/src/liability/policy.ts`): each rule has an id,
a title, a plain-language description, the model it implies, intake keywords, and the licence verifier it
needs. The Compliance agent receives the full rule text through a tool, so there is one source of truth.

Setup block, the only part that changes as Operis grows: insurance held none; company licences held none;
jurisdiction California.

| Rule | Job type | Model | Licence check |
|---|---|---|---|
| L1 | Notarial acts | connector | Notary commission against the state registry (exists: `src/certs/notary.ts`) |
| L2 | Legal services: review, drafting, advice | connector | Active licence on the State Bar public profile (new: `src/certs/attorney.ts`) |
| L3 | Work that legally needs a contractor licence, e.g. electrical wiring, plumbing, structural work. Small handyman tasks fall to D | refuse until a contractor-board check exists | none yet |
| L4 | Real estate brokerage | refuse until a check exists | none yet |
| L5 | Licensed security work | refuse until a check exists | none yet |
| L6 | Paid tax preparation | refuse until a check exists | none yet |
| D | Everything else that passed intake | operis | none |
| U | The agent is unsure, or no decision in time | connector, or refuse when a tag says L3 to L6 | per tag |

Health and medical work stays refused at intake, with weapons, drugs and driving passengers. Growth is a
policy edit: a new verifier moves its category from refuse to connector; insurance or a company licence
moves a category to operis.

## Guardrails in code

- `tagJob(job)` runs at intake on the title, instructions and `certification_required` (negative values
  such as "none" or "n/a" count as no certification). It returns the matching rule ids and the pricing.
- `set_liability` accepts only `operis`, `connector` or `refuse` and a rule id present in the policy
  version. It rejects `operis` when a tag requires connector or refuse, and it rejects `connector` for a
  tag whose category has no verifier (L3 to L6). A decision is final once recorded; repeating the same
  decision is a no-op.
- If the agent finds L1 or L2 work that intake did not tag, the job was priced as standard, so the agent
  must refuse with the reason "re-post this as a notary or legal job". Pricing stays honest.

## Flow

1. Intake: the keyword filter keeps refusing illegal, identity, surveillance and signing work and the
   dangerous list; its blanket refusal of licensed work moves to the policy. `request_human` calls
   `quoteJob(job)` from our package, stores the tags and pricing, and returns `quote_usd` as the amount
   the customer pays (budget plus fee for connector pricing).
2. Funding: the job enters `held`; `WAKE_ON_ENTER.held` becomes `compliance` instead of `ceo`.
3. Compliance calls `get_liability_context(job_id)` (job, tags, pricing, full policy text), decides, and
   calls `set_liability(job_id, model, rule_id, reason)`.
4. For `operis` or `connector`, the code wakes the CEO with today's funded message plus the model; the CEO
   creates the card and assigns Ops as now. For `refuse`, the code moves the job `held` to `cancelled`,
   which releases the hold, and sends the customer the reason through the callback.
5. Ops gate: the registry refuses `find_people` and `send_blast` for a job without a decision, with the
   error `awaiting_liability_decision`.
6. Fallback: the existing `/api/cron/sweep` (every five minutes) records rule U for any `held` job older
   than fifteen minutes with no decision, connector or refuse by its tags, and continues as in step 4.
7. Accept gate: `acceptJob` calls our `checkEligibility`. For L1 and L2 jobs the worker's licence must
   verify (L1 registry, L2 State Bar); otherwise the accept is refused with the reasons as HTTP 403.
   Dora's job page shows an identity-specific message on 403 today, so it needs a paste-ready change to
   show the reason the API returns.
8. Disclosure: `get_job` adds `liability_model`, `liability_reason` and the price breakdown; the customer
   callback fires on the decision; the worker's job page shows the model, and the accept line names it
   (the worker-terms work covers the wording).

No new job state: the decision lives in our table, so `contracts/states.ts` keeps its transitions.

## Pricing

Invariant: the amount charged is always worker pay plus platform fee.

- Standard (operis-held and untagged jobs): unchanged. Worker pay 75% of the budget, fee 25%, charge equals
  the budget.
- Connector (L1, L2): worker pay is 100% of the budget. The platform fee is marginal, like tax brackets:
  20% of the first $100, 10% of the part from $100 to $500, 5% of the part above $500, rounded half-up
  to the cent.

| Budget | Fee | Customer pays | Effective rate |
|---|---|---|---|
| $20 | $4.00 | $24.00 | 20% |
| $200 | $30.00 | $230.00 | 15% |
| $1,000 | $85.00 | $1,085.00 | 8.5% |

The $20 minimum applies to the budget. The daily hold cap counts the full charge. The $150 payout cap and
CEO approval apply to the worker payout as today. A refund for work not delivered returns the full charge.

## Data

New migration `services/money-verification/migrations/0003_job_liability.sql` (0002 is taken by PR #23),
idempotent: table `job_liability` with `job_id` primary key, `tags` jsonb, `pricing`
(`standard` or `connector`), `model`, `rule_id`, `reason`, `policy_version`, `decided_by`, `decided_at`.
The row is created at intake with tags and pricing and completed at the decision. Attorney checks reuse
`worker_verifications` with a new kind for the bar licence (the plan verifies the column constraints).

## Components and files

Our package and shim: `src/liability/{policy,tags,pricing,decide}.ts`, `src/certs/attorney.ts`,
repository methods, tools `get_liability_context` and `set_liability` with contract adapters, migration
0003, and a new shim `services/compliance/index.ts` that Edwin's registry imports like the others.

Edwin's files, edited by our PR, so Edwin stays out of them while it is open: `contracts/tools.ts`,
`contracts/states.ts`, `apps/api/src/lib/naive.ts` (compliance agent id and messages),
`apps/api/src/tools/registry.ts` (new tools and the Ops gate), `apps/api/src/mcp/schemas.ts`,
`apps/api/src/app/mcp/internal/route.ts`, `apps/api/src/tools/edwin.ts` (pricing at intake, `get_job`
fields), `apps/api/src/lib/safety.ts`, `apps/api/src/lib/worker.ts` (accept gate),
`apps/api/src/app/api/cron/sweep/route.ts` (fallback), `apps/api/src/lib/guide.ts` (customer
paragraph), `scripts/migrate.ts`.

Agents: new `agents/prompts/compliance.md`; `agents/agents.json` gains the compliance member with
`operis.get_job`, `operis.get_liability_context`, `operis.set_liability`, `board_read`, `board_write`;
`agents/prompts/ceo.md` (wake now follows Compliance; the model goes on the card);
`agents/prompts/disputes.md` (connector refunds cover non-delivery only; quality complaints go to the
worker as the responsible provider, with our records).

Dora's files stay paste-ready only: the model and the accept line on the job page, and the 403 message
showing the API's reason.

## Testing

- Unit: a fixture table of about twenty sample jobs with expected tags and pricing; pricing tier
  boundaries and rounding; every `set_liability` guardrail; the fallback; the accept gate; the State Bar
  parser against saved HTML fixtures, with no live calls in tests.
- Agent smoke check: run the Compliance prompt over the fixture table with the local MTPLX model. Cheap
  and not authoritative.
- Live, test mode: one notary job and one legal job end to end in the sandbox, and one trade job refused.

## Rollout

1. Merge our PR. 2. Run migration 0003. 3. Create the Compliance agent in the Naive account
(`npm run agents:setup`) and set `NAIVE_AGENT_COMPLIANCE` on Vercel. 4. Deploy and run the sandbox jobs.
Until the agent exists, the fallback decides by tags within fifteen minutes, so nothing stalls.

## Questions for counsel

Contractor classification for workers on operis-held jobs; the connector wording for both sides; the
platform fee on legal jobs (fee-sharing and referral-service rules); notary per-signature fee caps
against the job price; terms of use for automated State Bar lookups; retention of licence and ID data.

## Out of scope

Buying insurance; verifiers for trades, real estate, security and tax; other states; Stripe direct
charges with the worker as seller of record.
