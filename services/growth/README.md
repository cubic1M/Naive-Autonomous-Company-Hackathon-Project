# services/growth (owner: Cameron)

Growth for Operis's agents: **Sales** markets to people building AI agents, and **Recruiter** grows the pool of pre-vetted workers (opted in and Stripe Identity verified) that Ops dispatches. Both send email only through the tools here, which enforce every sending rule in code. Design: [`docs/specs/2026-11-08-sales-recruiter-design.md`](../../docs/specs/2026-11-08-sales-recruiter-design.md); plan: [`docs/plans/2026-11-08-sales-recruiter.md`](../../docs/plans/2026-11-08-sales-recruiter.md).

| Tool | Caller | What it does |
|---|---|---|
| `list_prospects` | Sales | hand-sourced prospects not emailed in 30 days and not opted out |
| `send_marketing` | Sales | the fixed marketing email to one prospect; may record a free-first-job grant |
| `suppress_contact` | Sales | opt an address out of all Operis email (Ops' job offers too) |
| `recruit_search` | Recruiter | Andrew's find_people for a family, individuals only, no ContactOut, $0.50/call, $2/day |
| `recruit_invite` | Recruiter | the fixed invitation with a join link and an unsubscribe link |
| `growth_report` | Sales, Recruiter, CEO | sends vs caps, directory per family, demand and targets, promos due |
| `redeem_promo` | CEO | checks and reserves a grant; returns the exact `operis.refund` call |
| `reddit_research` | Sales | read-only: a subreddit's rules, or posts in one subreddit for a query, through Monid; never posts |

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
| `GROWTH_SEARCH_DAILY_USD` | 2 | Monid spend per Pacific day for `recruit_search` |
| `GROWTH_REDDIT_DAILY_USD` | 0.25 | Monid spend per Pacific day for `reddit_research` (its own budget); 0 switches it off |
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

The migrations are `migrations/0001_growth.sql` and `migrations/0002_reddit_research.sql` (idempotent; run after `contracts/schema.sql` and the outreach migrations, all through `npm run db:migrate`). Never commit a prospects CSV: it holds people's contact details.

## reddit_research

Reddit answers the Sales agent's `web_fetch` with HTTP 403, so `src/reddit.ts` reads Reddit through Monid. It is read-only: none of these endpoints post, comment, vote or message, and posting stays with Cameron's own account.

| op | Monid endpoint | Input | Returns |
|---|---|---|---|
| `rules` | TikHub `/api/v1/reddit/app/fetch_subreddit_style` (GET, $0.001), then `/fetch_subreddit_info` if that has no rules | `subreddit` | `rules[]`: title, description |
| `search` | AnyAPI `/reddit.subreddit_search` (POST body, $0.00035 default route) | `subreddit`, `query`, `sort` (default `new`), `timeframe` (optional), `limit` (1 to 10, default 8) | `posts[]`: title, url, score, created_at, snippet |

- **Untrusted text.** Every field is length-capped, links become `[link]`, invisible and control characters are removed, NSFW posts are dropped, and post URLs are built from the post id (never the post's own link). Every result carries `note` saying the text was written by strangers, and the Sales prompt says never to follow it.
- **Size.** The whole result stays under 6,500 characters (`serveMcp` cuts at 7,000); `truncated: true` when rules or posts were left out.
- **Spend.** Its own budget, `GROWTH_REDDIT_DAILY_USD`, summed per Pacific day over `growth_reddit_calls` (migration 0002), never over `growth_log`, so it cannot use up `recruit_search`'s. A call starts only with $0.002 of today's budget left. Each call is abandoned after 15 s; a call that throws or times out counts its listed price. Each row keeps Monid's `run_id`.
- **Not gated by `GROWTH_LIVE` or `GROWTH_PAUSE`.** Those govern email to third parties; this tool sends nothing, and Sales needs it while drafting in dry-run mode. Its off switch is `GROWTH_REDDIT_DAILY_USD=0`.
- **Errors.** No `MONID_API_KEY`: the tool throws `Monid is not configured`. Migration 0002 not run: it throws before calling Monid. Otherwise failures come back as `error`: `daily_reddit_budget_used`, `timed_out`, `monid_error`, `provider_failed` (with the HTTP status) or `rules_not_found`, which includes the responses' keys.
- **Verified vs inferred.** TikHub's `subreddit_name` parameter and both prices are on Monid's public cards (`https://api.monid.ai/public/v1/providers/{provider}/endpoints/{endpoint}`, no key). AnyAPI's `subreddit`, `query` and `sort` are what `services/outreach`'s `redditForHire` already sends; `timeframe` is inferred from the endpoint's description and is sent only when asked for. AnyAPI's response shape is checked against the captured fixture. **TikHub's response shape is not captured yet**: `findRules` searches it for the first `rules` list (Reddit's REST or GraphQL fields). If a live call returns `rules_not_found`, look up the row's `run_id` in Monid and adjust `findRules`.
