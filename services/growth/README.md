# services/growth (owner: Cameron)

Growth for Operis's agents: **Sales** markets to people building AI agents, and **Recruiter** grows the pool of pre-vetted workers (opted in and Stripe Identity verified) that Ops dispatches. Both send email only through the seven tools here, which enforce every sending rule in code. Design: [`docs/specs/2026-11-08-sales-recruiter-design.md`](../../docs/specs/2026-11-08-sales-recruiter-design.md); plan: [`docs/plans/2026-11-08-sales-recruiter.md`](../../docs/plans/2026-11-08-sales-recruiter.md).

| Tool | Caller | What it does |
|---|---|---|
| `list_prospects` | Sales | hand-sourced prospects not emailed in 30 days and not opted out |
| `send_marketing` | Sales | the fixed marketing email to one prospect; may record a free-first-job grant |
| `suppress_contact` | Sales | opt an address out of all Operis email (Ops' job offers too) |
| `recruit_search` | Recruiter | Andrew's find_people for a family, individuals only, no ContactOut, $0.50/call, $2/day |
| `recruit_invite` | Recruiter | the fixed invitation with a join link and an unsubscribe link |
| `growth_report` | Sales, Recruiter, CEO | sends vs caps, directory per family, demand and targets, promos due |
| `redeem_promo` | CEO | checks and reserves a grant; returns the exact `operis.refund` call |

**The guard** (`src/guard.ts`) decides every message: paused → skip; opted out anywhere → skip; a real send of the same kind in the last 30 days → skip (team allowlist exempt); today's sends + dry runs at the cap (25 marketing, 40 invites) → skip; kind in `GROWTH_LIVE` and `GROWTH_POSTAL_ADDRESS` set → send; on `OUTREACH_TEST_ALLOWLIST` → send as a test; otherwise → dry run.

**Every email** names Operis, says it is marketing or an invitation, says how we found the person, carries the postal address and a one-click unsubscribe link (`/v1/growth/unsubscribe`, never expires). The join link (`/v1/growth/join`, 30 days) records the opt-in on a button press, never on GET, then offers Stripe Identity.

## Environment

| Env | Default | Meaning |
|---|---|---|
| `GROWTH_LIVE` | empty | `sales`, `recruit` or both: real sends to anyone (also needs `GROWTH_POSTAL_ADDRESS`) |
| `GROWTH_PAUSE` | false | stop all growth sends; `PAUSE_OUTREACH=true` stops them too |
| `OUTREACH_TEST_ALLOWLIST` | empty | team addresses that may get real email while not live (shared with services/outreach) |
| `GROWTH_POSTAL_ADDRESS` | empty | CAN-SPAM postal address; required for live sends |
| `GROWTH_SALES_DAILY_CAP`, `GROWTH_RECRUIT_DAILY_CAP` | 25, 40 | per Pacific day, sends + dry runs |
| `GROWTH_SEARCH_DAILY_USD` | 2 | Monid spend per Pacific day |
| `GROWTH_PROMO_MAX_GRANTS`, `GROWTH_PROMO_CAP_USD`, `GROWTH_PROMO_DAYS` | 20, 25, 14 | free first job |
| `GROWTH_SALES_NAIVE_IDENTITY_ID` + `GROWTH_SALES_NAIVE_INBOX_ID` | empty | marketing sender (replies wake Sales); else `GROWTH_SALES_AGENTMAIL_INBOX` |
| `GROWTH_RECRUIT_AGENTMAIL_INBOX` | `AGENTMAIL_INBOX` | invite sender |
| `PUBLIC_BASE_URL`, `LINK_SIGNING_SECRET`, `MONID_API_KEY`, `NAIVE_API_KEY`, `DATABASE_URL` | shared | |

## Run

```bash
cd services/growth
../../node_modules/.bin/vitest run          # tests (in memory)
../../node_modules/.bin/tsc --noEmit        # types
npx tsx scripts/dry-run.ts                  # the transcript in docs/dry-run.md; no network
npx tsx scripts/import-prospects.ts teams.csv            # check a hand-sourced CSV, write nothing
DATABASE_URL=... npx tsx scripts/import-prospects.ts teams.csv --write
```

The migration is `migrations/0001_growth.sql` (idempotent; run after `contracts/schema.sql` and the outreach migrations). Never commit a prospects CSV: it holds people's contact details.
