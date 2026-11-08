# Sales and Recruiter: marketing to agent builders and growing the pre-vetted worker pool

**Status:** design approved by Cameron in session sales-growth-ff6d5d on 2026-11-08 (UTC); this written spec awaits his review.
**Plan:** `docs/plans/2026-11-08-sales-recruiter.md` (written after this spec is approved).
**Labels:** VERIFIED = file:line opened in this session; INFERRED = reasoned, not checked.

## 1. Goal

Two agents run Operis's growth without the founders:

- **Sales** markets Operis to its customers (people building AI agents and autonomous companies, starting with the YC x Naïve hackathon teams) and answers people who write in.
- **Recruiter** (a new Naïve member) grows the directory of **pre-vetted** workers that Ops dispatches, in the job families where demand is heading.

Both send email only through new Operis tools that enforce every sending rule in code, so their calls can be auto-approved.

## 2. Decisions (Cameron, this session)

| Question | Decision |
|---|---|
| Agents | Sales for customers plus a new Recruiter member for workers |
| Channels | Email only (no SMS, DMs or public posts). All cold email goes through guarded `operis.*` tools that can go on `AUTO_APPROVE_TOOLS`. Naïve `email.send` stays for replies to people who wrote in and stays **off** auto-approve |
| Volume | Sales 25 marketing emails/day; Recruiter 40 invites/day; Monid search spend $2/day, all enforced in code. Naïve budgets: Sales $20/day (unchanged), Recruiter $10/day |
| Free first job | One per team: the first job up to $25 refunded in full once proof passes. At most 20 grants ($500), enforced by grant records; Sales records the grant, the CEO refunds when the job is paid |
| Pre-vetted | Opted in plus Stripe Identity verified. Licences (notary now, State Bar after the liability PR) are checked at the first licensed job and shown as a badge |
| Families | On-site gigs near Pier 70, mobile notaries in SF, California attorneys, developers for hackathon teams |
| Prospects | Hackathon teams are sourced **by hand** by the team and imported. Sales cold-emails only imported prospects |
| Build approach | New `services/growth` package plus contract tools (approach A) |
| Addition | Sales and Recruiter target from demand data: the most requested jobs and a projection of incoming demand (section 9) |

## 3. What "pre-vetted" can mean today

| Level | Where it lives | Before a job today? |
|---|---|---|
| Found (public work contact, not opted out) | `workers` + `worker_profiles` (Andrew) | yes |
| Opted in ("regular") | `worker_profiles.regular` | yes, but an emailed MORE/STOP is never processed: `handleReply` is wired only to SMS (VERIFIED `apps/api/src/app/webhooks/mobilerun/route.ts:39`; no inbound-email code in `apps/api` or `services/outreach`) |
| ID verified | `worker_verifications` kind `identity` (Cameron) | no: `POST /v1/worker/identity` needs a job token (VERIFIED `apps/api/src/app/v1/worker/identity/route.ts:9`) |
| Payout ready | `workers.stripe_connect_account` + Stripe `payouts_enabled`, checked live (VERIFIED `services/money-verification/src/payouts.ts:50-53`) | no (job token; money path) |
| Licence | `worker_verifications` kind `notary_commission`; `attorney_license` with the liability PR | no (job link) |

Worker accounts (`/signup`, `/onboarding`) run only against Dora's mock API: `apps/api` has no `/v1/auth` or `/v1/me` routes (VERIFIED: route listing of `apps/api/src/app`).

**This design:** pre-vetted = opted in (via a join link) **and** ID verified (via the same link, before any job). Payouts stay at the first payout, licences at the first licensed job.

## 4. Architecture

```
Sales (Naïve)        Recruiter (Naïve)        CEO (Naïve)
   │ list_prospects     │ recruit_search          │ growth_report
   │ send_marketing     │ recruit_invite          │ redeem_promo ──► operis.refund (existing)
   │ suppress_contact   │ growth_report
   │ growth_report      ▼
   ▼          internal MCP server (apps/api; contract tools)
services/growth ── guard ── templates ── links ── repo (growth_* tables)
   │ uses as a library, unchanged:  services/outreach (findPeopleDetailed, PostgresRepo, senders, optOut, setRegular)
   │ calls, unchanged:              services/verify createIdentityLink (Stripe Identity)
   ▼
operis.live/v1/growth/unsubscribe   operis.live/v1/growth/join  (new API routes; /v1/* is rewritten to the API, VERIFIED apps/web/next.config.ts:17)
```

### Files

New (this PR):
- `services/growth/` (package; owner: Cameron): `src/{env,guard,templates,links,demand,promo,sales,recruit,families,report,tools,repo,index}.ts`, `src/repo/{memory,postgres}.ts`, `migrations/0001_growth.sql`, `scripts/{import-prospects,dry-run}.ts`, `test/*.test.ts`, `tsconfig.json`, `vitest.config.ts`, `README.md`, `docs/dry-run.md` (the committed transcript).
- `apps/api/src/app/v1/growth/unsubscribe/route.ts`, `apps/api/src/app/v1/growth/join/route.ts`.
- `agents/prompts/recruiter.md`; rewrite of `agents/prompts/sales.md`.

Modified, additive hunks only (Edwin's files, none on the liability PR's list):
- `contracts/tools.ts`: seven tool specs, `Agent` gains `"recruiter"`, `TOOL_REGISTRY` entries.
- `apps/api/src/tools/registry.ts`: growth module in `REAL`, names in `INTERNAL_TOOLS`.
- `apps/api/src/mcp/schemas.ts`: the growth schemas, spread from `services/growth` (one import, one line at the end of `SCHEMAS`).
- `apps/api/src/tools/mocks.ts`: one mock per tool (required by its type, VERIFIED `apps/api/src/tools/mocks.ts:15`).

Not touched (frozen by open PRs or owned elsewhere): `agents/agents.json`, `apps/api/src/app/mcp/internal/route.ts`, `scripts/migrate.ts`, `agents/prompts/ceo.md`, `apps/api/src/lib/guide.ts` (liability PR's list, VERIFIED its plan line 23); everything in `services/money-verification`, `services/payments`, `services/verify` (PRs #23, #30, liability); `services/outreach` (Andrew); `apps/web` (Dora). Their changes ship as paste-ready snippets in the PR body.

## 5. Data model (`services/growth/migrations/0001_growth.sql`, idempotent, never run by this PR)

- `growth_contacts`: `id`, `kind` (`prospect` | `recruit`), `email` (lowercased), `name`, `org`, `family` (recruits), `worker_id` (recruits; references `workers`), `found_via` (required; quoted in every email), `notes` (prospects: what the team builds), `free_first_job` (prospects), `opted_out`, `opted_out_at`, `joined_at`, `last_contacted_at`, `created_at`; unique `(kind, email)`.
- `growth_log`: one row per send, dry run, skip, search, unsubscribe, join, identity start or suppression: `contact_id`, `kind`, `status` (`sent` | `dry_run` | `skipped` | `failed` | `ok`), `reason`, `family`, `cost_usd`, `ref`, `created_at`. Daily caps and the search budget are sums over this table.
- `growth_promos`: `contact_id`, `grant_key` (unique: the company domain, or the full address for free-mail domains), `cap_cents`, `expires_at`, `redeemed_job_id` (unique), `refund_cents`, `redeemed_at`, `created_at`.

## 6. The guard (`src/guard.ts`)

One function decides every outbound message: `decide({ kind: "marketing" | "invite", email, now })` → `send` | `dry_run` | `skip` with a reason. In order:

1. `GROWTH_PAUSE` or `PAUSE_OUTREACH` set → skip `paused`.
2. The address is opted out anywhere (any `growth_contacts` row or any `workers` row with that email) → skip `opted_out`.
3. A message of this kind went to the address in the last 30 days → skip `recently_contacted`.
4. Today's (America/Los_Angeles) `sent` + `dry_run` count for this kind has reached its cap (25 marketing, 40 invites) → skip `daily_cap`.
5. The kind is in `GROWTH_LIVE` (`sales`, `recruit`) **and** `GROWTH_POSTAL_ADDRESS` is set → `send`.
6. The address is in `OUTREACH_TEST_ALLOWLIST` (shared with Andrew's outreach) → `send`.
7. Otherwise → `dry_run` (logged, nothing sent).

Until Cameron says yes in this session, `GROWTH_LIVE` stays unset everywhere this PR touches, so only allowlisted team addresses can receive anything.

## 7. Messages (`src/templates.ts`, plain text)

The agent may supply at most one personal line (300 characters, single paragraph); everything else is fixed in code. Every message has:

- A sender that names Operis ("Operis Sales" for marketing, "Operis" for invites) and a subject that describes the email (no "Re:", no false urgency).
- A line saying what it is: "This is a marketing email from Operis." / "This is an invitation from Operis." (Not "one-time": the guard allows another message after 30 days.)
- Who we are, including that Sales is an AI agent: signature "Operis Sales (an AI agent) · operis.live".
- **How we found you**: the prospect's `found_via`, or for recruits the public profile and headline (the same wording as Andrew's `whyLine`).
- The postal address (`GROWTH_POSTAL_ADDRESS`; the allowlisted test sends use "postal address pending").
- A one-click unsubscribe link that works forever.

Marketing copy says what we sell (one MCP tool, `request_human`; verified humans for real-world tasks in San Francisco; pay only when proof passes; minimum job $20), how to connect (self-serve: `https://operis.live/developers`, `https://operis.live/SKILL.md`, MCP at `https://operis.live/mcp`; the current prompt's "API key from the founders" is stale, VERIFIED `apps/api/src/app/v1/customers/route.ts`), and, when granted, the free-first-job terms (up to $25, refunded once proof passes, valid 14 days). It never names another customer or quotes their jobs.

Invite copy describes the family's work, says each job shows its pay before you accept and is paid when the work is approved (no amounts: worker pay differs by job and liability model), and offers the join link ("one click, no account, no fee") and the ID check ("2 minutes with Stripe, once").

## 8. Tools (contract, internal MCP server)

| Tool | Caller | Input | Output |
|---|---|---|---|
| `list_prospects` | Sales | `{ limit? }` (1-50, default 20) | uncontacted, not opted-out prospects: `contact_id, name, org, email_domain, notes, found_via, free_first_job`; plus `sent_today`, `daily_cap` |
| `send_marketing` | Sales | `{ contact_id, personal_line?, offer_free_first_job? }` | `{ contact_id, status, reason?, promo? }`; refuses any id that is not an imported prospect |
| `suppress_contact` | Sales | `{ email, reason }` | `{ suppressed: true, matched_contacts, matched_workers }`; for replies that say stop; also opts the address out of Ops' outreach |
| `recruit_search` | Recruiter | `{ family, limit? }` (1-20, default 10) | `{ family, found, new, spend_usd, spend_today_usd, daily_cap_usd, candidates: [{ person_id, name, headline, source, score, distance_km }] }`, opted-out and recently invited people excluded |
| `recruit_invite` | Recruiter | `{ family, person_ids }` (1-20) | `{ sent, dry_run, skipped, failed, invites_today, daily_cap, results: [{ person_id, status, reason? }] }` |
| `growth_report` | Sales, Recruiter, CEO | `{}` | today's sends vs caps, search spend, directory per family (found, invited, opted_in, id_verified, licensed, target, gap), demand (section 9), promos (granted, redeemed, due) |
| `redeem_promo` | CEO | `{ job_id }` | `{ eligible: true, refund: { job_id, amount_cents, request_id, reason } }` or `{ eligible: false, reason }` |

`recruit_search` runs Andrew's `findPeopleDetailed` against a scratch in-memory job for the family (as `scripts/warm-pool.ts` does), keeps **individuals only**, drops the paid ContactOut work-email enricher (`linkedinWorkEmail`; enrichers are injectable, VERIFIED `services/outreach/src/find.ts:25,131`), caps each call at `min($0.50, what is left of $2 today)`, saves the people it found into the pool through Andrew's `upsertLead`, and records them as recruit contacts with `found_via`.

Families (`src/families.ts`):

| Key | Search | Floor target |
|---|---|---|
| `pier70_gigs` | on-site within 8 km of Pier 70 (37.7609, -122.3875): brand ambassador, event staff, street team, event photographer, courier, errand runner | 15 |
| `sf_notaries` | on-site SF: mobile notary, notary signing agent, loan signing agent; credential "notary public" | 5 |
| `ca_attorneys` | remote: contract, technology and startup attorneys; SaaS, contracts, privacy; credential "California bar license" | 5 |
| `developers` | remote: Next.js, React, TypeScript, full-stack developers | 10 |

## 9. Demand-driven targeting (added at Cameron's request)

`src/demand.ts` reads `jobs` (read-only) and classifies each job into a family by keywords over the title, instructions and `certification_required` (notary → `sf_notaries`; attorney, lawyer, legal or contract review → `ca_attorneys`; developer, code, bug, deploy, React, Next.js, TypeScript → `developers`; any other on-site job within 8 km of Pier 70 → `pier70_gigs`; anything else → `other`, reported so unmet job types stay visible).

Per family it reports `last_7d` (jobs created in the last 7 days), `prior_7d` (the 7 days before), `projected_next_7d = last_7d + max(0, last_7d − prior_7d)` (growth is extrapolated, a decline is held flat), and `unfilled_7d` (jobs from the last 7 days that expired or were cancelled with no worker, or sat in outreach for over 15 minutes with no worker). It also lists the 5 most requested job titles of the last 30 days, for internal use only.

Targets are computed in code, so the agents do no arithmetic: `target = max(floor, min(60, 3 × (projected_next_7d + unfilled_7d)))`, meaning three pre-vetted people per expected job plus every job we failed to fill. `gap = max(0, target − pre_vetted)`.

- **Recruiter** works the family with the largest gap first, and spends the day's invite cap across families in gap order.
- **Sales** leads with the use cases that have both demand and supply (`pre_vetted > 0`), orders prospects by how well their notes fit those families, and never promises a job type we have no pre-vetted people for.

## 10. Links and routes

- **Tokens** (`src/links.ts`): HMAC-SHA256 over `growth:<purpose>:<contact_id>[:<expiry>]` with `LINK_SIGNING_SECRET` (domain-separated from job links), base64url. No email or name in the URL. Unsubscribe tokens never expire; join tokens last 30 days.
- **`/v1/growth/unsubscribe?t=…`** (GET and POST, one click, no login): marks every growth contact with that address opted out and calls Andrew's `optOut({ email })`, which sets `workers.opted_out` and clears `regular` (VERIFIED `services/outreach/src/repo/postgres.ts:234-246`), so Ops' `send_blast` never emails them either. Returns a short HTML page. A bad token still gets a page with a way out ("email ops@operis.live and we will remove you").
- **`/v1/growth/join?t=…`**: GET shows a confirm page; nothing changes on GET, so email link scanners cannot opt anyone in. POST `action=opt_in` calls `setRegular(worker_id, true)` (which refuses opted-out workers, VERIFIED `postgres.ts:252-257`), sets `joined_at`, then shows "Verify my ID". POST `action=identity` calls `createIdentityLink(worker_id)` from `services/verify` (VERIFIED `services/verify/index.ts`) and redirects to Stripe; "already verified" shows a page instead. Stripe returns to Dora's `/join/<workerId>/identity/done`.

## 11. Free first job

- Granted only by `send_marketing(offer_free_first_job: true)`, only for prospects imported with `free_first_job = yes`, and only when the email's status is `sent` (a real send, live or allowlisted; dry runs promise nothing).
- One grant per `grant_key`; at most `GROWTH_PROMO_MAX_GRANTS` (20); cap `GROWTH_PROMO_CAP_USD` ($25); expires `GROWTH_PROMO_DAYS` (14) after the email.
- `growth_report.promos.due` lists paid jobs whose customer (`customers.contact_email`, exact address or same `grant_key` domain) holds an unexpired, unredeemed grant, where the job was created after the grant and is that customer's first paid job.
- `redeem_promo(job_id)` re-checks all of that, reserves the grant atomically, and returns the exact refund: `amount_cents = min(cap, job price)`, `request_id = "promo:<grant id>"`, reason "Free first job (Operis Sales offer)". Calling it again for the same job returns the same instruction; a second job is refused.
- The CEO already has `operis.refund` (VERIFIED `agents/agents.json`, CEO tools). A refund works on any captured job (VERIFIED `services/money-verification/src/escrow.ts:282`); the worker is still paid, so Operis absorbs the cost. `docs/GO_LIVE.md` says Stripe is in test mode (INFERRED from the doc, not the key), so today the cost is zero.

## 12. Agents

- `agents/prompts/sales.md` (rewrite): customers and offer as in section 7; each scheduled round: `growth_report`, `list_prospects`, optionally `web_fetch` the team's public page for one personal line, `send_marketing`, a one-line board note. Replies: answer people who wrote in with `email.send`; a reply that asks to stop gets `suppress_contact` first and no answer. Never invent prices, features or availability; never discount below the $20 minimum; free first job only through the tool.
- `agents/prompts/recruiter.md` (new): each round: `growth_report`, then the largest-gap family, `recruit_search`, `recruit_invite` for the best individuals, a board note with counts. Never contact anyone outside the tools, never promise jobs or amounts, never say anyone is licensed or verified, never text or DM.
- Snippets for `agents/agents.json` (PR body):
  - `sales`: add `operis.list_prospects`, `operis.send_marketing`, `operis.suppress_contact`, `operis.growth_report`; schedule `0 10,15 * * *` PT, budget $1, **enabled: false**.
  - `recruiter` (new member `operis-recruiter`): `operis.recruit_search`, `operis.recruit_invite`, `operis.growth_report`, `board_read`, `board_write`; budget cap $10, max task $3; schedule `0 9,12,15 * * *` PT, budget $1, **enabled: false**.
  - `ceo`: add `operis.growth_report`, `operis.redeem_promo`.
- Snippet for `agents/prompts/ceo.md`: the team includes Recruiter; in the daily report, call `growth_report`, and for each promo due call `redeem_promo` then `operis.refund` with exactly the returned values.

## 13. Configuration

| Env | Default | Meaning |
|---|---|---|
| `GROWTH_LIVE` | empty | `sales`, `recruit` or both: real sends to anyone (still needs a postal address) |
| `GROWTH_PAUSE` | false | stop all growth sends (`PAUSE_OUTREACH` also stops them) |
| `OUTREACH_TEST_ALLOWLIST` | empty | team addresses that may receive real email while not live (shared) |
| `GROWTH_POSTAL_ADDRESS` | empty | CAN-SPAM postal address; required for live sends |
| `GROWTH_SALES_DAILY_CAP` / `GROWTH_RECRUIT_DAILY_CAP` | 25 / 40 | messages per Pacific day |
| `GROWTH_SEARCH_DAILY_USD` | 2 | Monid spend per Pacific day for `recruit_search` |
| `GROWTH_PROMO_MAX_GRANTS` / `GROWTH_PROMO_CAP_USD` / `GROWTH_PROMO_DAYS` | 20 / 25 / 14 | free first job |
| `GROWTH_SALES_NAIVE_IDENTITY_ID` + `GROWTH_SALES_NAIVE_INBOX_ID` | empty | send marketing from the Naïve Sales inbox (replies wake Sales); else `GROWTH_SALES_AGENTMAIL_INBOX`; else nothing is sent (status `failed`, reason `no_sender`) |
| `GROWTH_RECRUIT_AGENTMAIL_INBOX` | `AGENTMAIL_INBOX` | invites go out from Andrew's existing sender (`ops@mail.operis.live`) |
| `PUBLIC_BASE_URL`, `LINK_SIGNING_SECRET`, `MONID_API_KEY`, `NAIVE_API_KEY`, `DATABASE_URL` | existing | shared |

## 14. Errors

- Expected outcomes are results, not errors: `skipped` / `dry_run` / `failed` with a reason the agent can act on.
- Missing tables (Postgres 42P01) → tool error "growth tables missing: run services/growth/migrations/0001_growth.sql".
- A failed send is logged and returned; nothing retries it automatically.
- A Monid failure returns `found: 0` with the error and still records the spend.
- An identity start failure shows "We couldn't start the ID check; try again later" (no internals on the page).

## 15. Testing

- vitest in `services/growth` against an in-memory repo and Andrew's `InMemoryRepo`: every guard branch; template parts (sender, label, found-via, address, unsubscribe link, personal-line cap); tampered and expired tokens; prospects-only marketing; one grant per domain and the 20-grant cap; recruit search with a fake Monid (individuals only, no ContactOut, spend cap); invite → join → `regular`; unsubscribe → `opted_out` in both places and the next send skipped; demand classification, projection and targets; `redeem_promo` eligibility and idempotency.
- The migration and the Postgres repo's SQL against an in-memory PGlite installed in the session scratchpad (not a repo dependency). If that cannot run, the PR says NOT RUN.
- `apps/api` typecheck over the contract, registry, schema, mock and route changes.
- `services/growth/docs/dry-run.md`: the committed output of `scripts/dry-run.ts` (no network, recording sender, fixture addresses): a marketing email and an invite to an allowlisted address (sent to the recorder) and to a non-allowlisted one (dry run), an unsubscribe click, and the next send skipped.

## 16. Rollout (Cameron) and asks of others

Cameron, in order:
1. A real postal address (PO box or virtual mailbox) → `GROWTH_POSTAL_ADDRESS` on operis-api.
2. Confirm or create the Naïve Sales identity inbox and set its two ids, so replies wake Sales.
3. Run `services/growth/migrations/0001_growth.sql` (and add it to `scripts/migrate.ts` after the liability PR merges).
4. Apply the `agents.json` and `ceo.md` snippets, then `npm run agents:setup` (needs his yes).
5. Add `operis.list_prospects,operis.send_marketing,operis.suppress_contact,operis.recruit_search,operis.recruit_invite,operis.growth_report,operis.redeem_promo` to `AUTO_APPROVE_TOOLS` (the rules they would protect are enforced in code; `redeem_promo` only checks and reserves a grant, while the refund itself stays `operis.refund`). Leave `email.send` off it.
6. Import the hand-sourced team CSV with `services/growth/scripts/import-prospects.ts`.
7. One real test send to an allowlisted team address; then set `GROWTH_LIVE=sales,recruit` and enable the two schedules.

Andrew (review; no change to his code required): the reuse of `findPeopleDetailed`, `upsertLead`, `setRegular`, `optOut` and his senders. Follow-ups for him: rank ID-verified regulars above other candidates; process emailed STOP/MORE replies (nothing reads inbound email today).
Dora: `/join/<id>/identity/done` tells people to "go back to your job link", which is wrong for recruits; a copy snippet is in the PR body.
Edwin: review the four additive hunks and the two new routes; apply the snippets for `agents.json`, `ceo.md` and `scripts/migrate.ts` after the liability PR merges. Pre-existing drift: `apps/api/src/lib/guide.ts:175` says "five AI agents".

## 17. Out of scope

SMS, DMs and public posts; automatic prospect discovery (prospects are hand-sourced); worker accounts; payout setup before a job; licence checks before a job; processing inbound email for ops@; a directory page on the website; recording search spend in Cameron's ledger (kept in `growth_log` until he agrees).
