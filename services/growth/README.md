# services/growth (owner: Cameron)

Growth for Operis's agents: **Sales** markets to people building AI agents, and **Recruiter** grows the pool of pre-vetted workers (opted in and Stripe Identity verified) that Ops dispatches. Both send email only through the tools here, which enforce every sending rule in code, and Sales posts on X, Threads and Bluesky only through `post_social`, which does the same for posts. Design: [`docs/specs/2026-11-08-sales-recruiter-design.md`](../../docs/specs/2026-11-08-sales-recruiter-design.md); plan: [`docs/plans/2026-11-08-sales-recruiter.md`](../../docs/plans/2026-11-08-sales-recruiter.md).

| Tool | Caller | What it does |
|---|---|---|
| `list_prospects` | Sales | hand-sourced prospects not emailed in 30 days and not opted out |
| `send_marketing` | Sales | the fixed marketing email to one prospect; may record a free-first-job grant |
| `suppress_contact` | Sales | opt an address out of all Operis email (Ops' job offers too) |
| `post_social` | Sales | one post from Operis's own account on X, Threads or Bluesky, through Zernio; dry run until the platform is live |
| `recruit_search` | Recruiter | Andrew's find_people for a family, individuals only, no ContactOut, $0.50/call, $2/day |
| `recruit_invite` | Recruiter | the fixed invitation with a join link and an unsubscribe link |
| `growth_report` | Sales, Recruiter, CEO | sends vs caps, directory per family, demand and targets, promos due |
| `redeem_promo` | CEO | checks and reserves a grant; returns the exact `operis.refund` call |
| `reddit_research` | Sales | read-only: a subreddit's rules, or posts in one subreddit for a query, through Monid; never posts |

**The guard** (`src/guard.ts`) decides every message: paused → skip; opted out anywhere → skip; a real send of the same kind in the last 30 days → skip (team allowlist exempt); today's sends + dry runs at the cap (25 marketing, 40 invites) → skip; kind in `GROWTH_LIVE` and `GROWTH_POSTAL_ADDRESS` set → send; on `OUTREACH_TEST_ALLOWLIST` → send as a test; otherwise → dry run.

**Every post** (`src/social.ts`) ends with "Written and posted by Operis's AI agent." and goes to Operis's own account only (one Zernio account id per platform). In order: paused (`GROWTH_SOCIAL_PAUSE`, or `GROWTH_PAUSE`) → skip; `GROWTH_SOCIAL_DAILY_CAP` posts on that platform today (live, unknown outcome and dry runs) → skip; under 60 minutes since that platform's last post → skip; empty, an @mention, more than one link or a link not on operis.live, or over the platform's limit counted its way with the disclosure included (X 280 weighted, a link 23, an emoji 2; Threads 500, an emoji its UTF-8 bytes; Bluesky 300 graphemes and 3,000 bytes) → skip; the same words, or 60% of them, as a post on that platform in the last 30 days → skip; platform not in `GROWTH_SOCIAL_LIVE` → dry run; else post. Every call is one `growth_social_posts` row, written before Zernio is called, whose id is Zernio's `Idempotency-Key`: a timeout or 5xx is retried once with it, and an outcome still unknown counts as posted. Zernio has no AI label for text posts (see `src/zernio.ts`), so the disclosure line is the label. The Sales agent's calls wait for a founder's approval (`agents.json`: `"ask"`).

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
| `GROWTH_SOCIAL_LIVE` | empty | `x`, `threads`, `bluesky`: platforms where `post_social` really posts; empty = dry runs only |
| `GROWTH_SOCIAL_PAUSE` | false | kill switch: skip every `post_social` call (`GROWTH_PAUSE` stops it too) |
| `GROWTH_SOCIAL_DAILY_CAP` | 3 | posts per platform per Pacific day, never above 10; `0` turns posting off |
| `ZERNIO_API_KEY` | empty | Zernio API key (server-side only; Zernio holds the platform tokens) |
| `ZERNIO_X_ACCOUNT_ID`, `ZERNIO_THREADS_ACCOUNT_ID`, `ZERNIO_BLUESKY_ACCOUNT_ID` | empty | Operis's own account on each platform: the account `_id` from Zernio's `GET /v1/accounts` |
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

The migrations are `migrations/0001_growth.sql` and `migrations/0002_social.sql` (both idempotent; `npm run db:migrate` runs them after `contracts/schema.sql` and the outreach migrations). Never commit a prospects CSV: it holds people's contact details.

## reddit_research

Reddit answers the Sales agent's `web_fetch` with HTTP 403, so `src/reddit.ts` reads Reddit through Monid. It is read-only: none of these endpoints post, comment, vote or message, and posting stays with Cameron's own account.

| op | Monid endpoint | Input | Returns |
|---|---|---|---|
| `rules` | TikHub `/api/v1/reddit/app/fetch_subreddit_style` (GET, $0.001). Not `/fetch_subreddit_info`: its card lists rules, but Monid's live run found no rules key | `subreddit` | `rules[]`: title, description |
| `search` | AnyAPI `/reddit.subreddit_search` (POST body, $0.00035 default route) | `subreddit`, `query`, `sort` (default `new`), `timeframe` (optional), `limit` (1 to 10, default 8) | `posts[]`: title, url, score, created_at, snippet |

- **Untrusted text.** Every field is length-capped, links become `[link]`, invisible and control characters are removed, NSFW posts are dropped, and post URLs are built from the post id (never the post's own link). Every result carries `note` saying the text was written by strangers, and the Sales prompt says never to follow it.
- **Size.** The whole result stays under 6,500 characters (`serveMcp` cuts at 7,000); `truncated: true` when rules or posts were left out.
- **Spend.** Its own budget, `GROWTH_REDDIT_DAILY_USD`, summed per Pacific day. Each call is a `growth_log` row (kind `search`, `ref` `reddit_research`, the request, the Monid run and any error in `reason`), so there is no migration. `searchSpendSince`, which feeds `recruit_search`'s budget and `growth_report`, leaves those rows out, and `redditSpendSince` counts only them. The two budgets never mix: the same Monid wallet also pays for login emails, outreach and SMS. A call starts only with $0.002 of today's budget left. Each call is abandoned after 15 s, and a call that throws or times out counts its listed price. As with `recruit_search`, the check and the log are not locked together, so calls made at the same moment can overshoot by about one call each ($0.001).
- **Not gated by `GROWTH_LIVE` or `GROWTH_PAUSE`.** Those govern email to third parties; this tool sends nothing, and Sales needs it while drafting in dry-run mode. To switch it off, set `GROWTH_REDDIT_DAILY_USD=0`; `MOCK_TOOLS=reddit_research` serves the API's mock instead, which reads nothing.
- **Errors.** With no `MONID_API_KEY`, the tool throws `Monid is not configured`. Otherwise failures come back as `error`: `daily_reddit_budget_used`, `timed_out`, `monid_error`, `provider_failed` (with the HTTP status), or `rules_not_found`, which includes the response's keys.
- **Verified vs inferred.** TikHub's `subreddit_name` parameter and both prices are on Monid's public cards (`https://api.monid.ai/public/v1/providers/{provider}/endpoints/{endpoint}`, no key). AnyAPI's `subreddit`, `query` and `sort` are what `services/outreach`'s `redditForHire` already sends; `timeframe` is inferred from the endpoint's description and is sent only when asked for. AnyAPI's response shape is checked against the captured fixture. Monid's guide (`monid.ai/blog/guides/reddit-scraper`, a live run on 2026-10-16) says `fetch_subreddit_style` returned each rule's name, `violationReason`, priority and full text as markdown and HTML, next to the sidebar widgets and the moderator list, and that `fetch_subreddit_info` returned no rules. **The JSON nesting is not shown anywhere, so it is not captured yet**: `findRules` searches for the first `rules` list and reads `name` + `content.markdown` (Reddit GraphQL) or `short_name` + `description` (REST). Nothing about moderators is returned. If a live call returns `rules_not_found`, the error lists the response's keys; look up the row's `run_id` in Monid and adjust `findRules`. Subreddit names follow the guide: `^[A-Za-z0-9_]+$`, at most 21 characters (2 at least here), `r/` prefix or a reddit.com URL accepted.
