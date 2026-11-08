# Operis: how we use every tool (brief for the demo video)

Operis is **humans on demand for autonomous companies**. A customer's AI agent calls one MCP tool, `request_human`,
and a verified person in San Francisco does the real-world job: photographing or checking a place, a pickup,
paperwork. The company itself is run by **8 Naïve agents**. Founders only see a live backoffice.

Everything below is verified in this repo or in production (Nov 8, 2026). Items marked **Built, not live** exist in
code but aren't switched on; say so honestly in the video.

---

## The story in one line per tool

| Tool | Role in Operis | One-line hook for the video |
|---|---|---|
| **Naïve** | The whole company: 8 agents, board, skills, approvals, budgets, vault, webhooks, deployments, model proxy | "No employees. Eight Naïve agents run Operis." |
| **Monid** | Finds people (6 people sources, 2 business sources, 6 enrichers) and sends email via AgentMail | "One gateway, a dozen data sources, every cent budgeted." |
| **AgentMail** (through Monid) | Job offers and login emails from `ops@mail.operis.live` | "The agents email real people, from our own domain." |
| **Stripe** | Escrow, saved cards, Connect payouts, Identity, refunds, disputes. **Live mode.** | "Money is held before anyone moves; the worker is paid the minute proof passes." |
| **Neon** | Postgres for everything: 35 tables, 20 migrations | "One database is the company's memory and ledger." |
| **Vercel** | 2 apps, domains + DNS, crons, Blob for proof photos | "Deployed on operis.live with a self-running sweep." |
| **Google** | Sign in with Google for workers and founders | "Workers join in one tap." |
| **Mobilerun** | SMS adapter + signed inbound webhook. **Built, not live** (no number bought; we chose email) | Mention only as "SMS-ready". |
| **MCP** (the protocol) | Our product surface: OAuth, self-serve keys, SKILL.md, directory discovery | "Any agent (Claude Code, Cursor, Claude.ai, Naïve) can hire a human." |

---

## 1. Naïve: the company runs on it

**8 agents, defined in one committed file** (`agents/agents.json`, applied by `agents/setup.ts`). All run on
`anthropic/claude-haiku-5.5`, with a USD cap per agent and per task.

| Agent | Job | Tools | Budget (cap / per task) |
|---|---|---|---|
| CEO (coordinator) | Takes each funded job, makes a board card, delegates, approves large money moves | 13 | $300 / $25 |
| Compliance | Decides liability per job: Operis holds it, connector, or refuse (policy v2026-11-08) | 5 | $20 / $2 |
| Ops | Finds workers (`find_people`) and sends offers (`send_blast`); loads skill `worker-sourcing@2` | 5 | $40 / $5 |
| Verifier | Checks proof with vision (`view_image`, `check_proof`), approves or escalates | 7 | $40 / $3 |
| Finance | Captures payment, pays the worker, refunds, P&L (`ledger`) | 8 | $20 / $5 |
| Disputes | Wakes on a chargeback, gathers evidence, drafts the Stripe response | 11 | $20 / $5 |
| Sales | Finds companies that need humans, sends guarded marketing | 12 | $20 / $5 |
| Recruiter | Grows the worker pool from public profiles, sends invites | 5 | $10 / $3 |

**Naïve features we use:**
- **Multi-agent coordinator plus a shared board.** The CEO is a coordinator: `board_write` with create/assign/comment, `send_to_agent`, `wait_for_agents`.
- **Event-driven wake-ups.** Each job state change wakes exactly one agent through `POST /v1/sessions` with `metadata.job_id` and a per-session budget. It's idempotent, so a duplicate webhook never starts a second session (`contracts/states.ts` `WAKE_ON_ENTER`, `apps/api/src/lib/naive.ts`).
  - Funded → Compliance → CEO → Ops
  - Proof submitted → Verifier
  - Approved → Finance
  - Chargeback → Disputes
- **Our own MCP server inside Naïve.** Agents call `operis.*` tools on `api.operis.live/mcp/internal`. The key sits in a Naïve **vault** (`static_bearer` bound to the MCP URL), so it never appears in a prompt.
- **Skills:** `worker-sourcing@2`, versioned and pinned.
- **Approvals, the human-at-the-edge model.** Naïve freezes risky calls. Our cron reads pending `tool.confirm` events and auto-approves exactly what `agents.json` allows for each role (`AUTO_APPROVE_FROM_AGENTS_JSON`). `ask_operator` and `email.send` always wait for a founder. Each approval is logged in the feed ("auto-approved by founder policy"). Approvals use `POST /sessions/{id}/tool_confirmations`.
- **Budgets:** per-agent caps, per-task caps, and per-session `budget_micro_usd`.
- **Webhooks** (`session.idle`) and a session events feed. Agent activity is pulled into our DB (`agent_events`) and shown live in the backoffice as plain sentences.
- **Deployments / cron:** the CEO's daily report at 08:00 PT. Sales, Recruiter and Ops schedules are written but **disabled for now**.
- **Model proxy:** the Verifier's vision model runs through Naïve's OpenAI-compatible endpoint (`https://api.vetta.sh/v1/proxy/openai/v1`).
- **Founder notifications** via Naïve email (`FOUNDER_EMAIL`).

**Why it's "pushed to the limit":** Naïve has 59 primitives and **none of them reaches the physical world**. Operis is that missing primitive, a human you can call, and it's built out of Naïve itself.

---

## 2. Monid: one gateway to people (and email)

**Finding workers** (`services/outreach`, Andrew). `find_people` runs sources in parallel, cheapest first:
- **People:** Google profiles via litescrape (the cheapest query), X users via anyapi, Reddit r/forhire, r/sanfrancisco and r/bayarea via anyapi, context.dev people search, LinkedIn via ploid ($0.15, 15 results).
- **Businesses for on-site jobs:** Google Maps, then a nearby-places fallback.
- **Enrichment, cheapest first, stopping at the first email:** GitHub profile (direct API, $0), X bio (twitterdata.io), Instagram contact (anyapi), website crawl (search1api), web presence, and ContactOut work email ($0.10) as the last resort.

**Budgeted to the cent:**
- **Spend cap:** `OUTREACH_MAX_SPEND_USD=0.50` per search. Every source's worst-case cost is booked before it runs, and query lists are trimmed to the budget left.
- **Time budget:** 30 s total and 10 s per call. Enrichment starts at 60% of the time budget, 16 at a time.
- **Real charges:** spend is read back from Monid's actual charge, never the estimate, and booked as `scrape_cost` on the job's ledger.

**Ranking:**
- **Score weights:** match 0.4, distance 0.2, contact 0.17, recency 0.08, open-to-work 0.08, rating 0.07. Regulars get +0.3, a required credential +0.2 (−0.3 without it).
- **Order:** regulars first, then score, then distance.
- **Dedupe:** by identity (LinkedIn > email > GitHub > X > …), and profiles from different sources are merged. People we already know are reused, so we never pay to enrich anyone twice.

**Talent pool first:** `warm-pool.ts` built a pool across 13 job families. In production we pulled **387 people for $4.39**. A search checks the pool and regulars first, and if they fill the list, **no live scraping runs at all**.

**Growth** (`services/growth`, Cameron): the **Sales** and **Recruiter** agents' tools are `list_prospects`, `send_marketing`, `suppress_contact`, `recruit_search`, `recruit_invite`, `growth_report` and `redeem_promo`.
- **Guard:** one function decides every send. Daily caps are 25 marketing and 40 invites, plus $2 a day of search spend.
- **Repeats and opt-outs:** nobody gets the same kind of email twice within 30 days, and opting out anywhere means never again.
- **Free first job:** up to 20 grants of $25 each.
- **Live switch:** `GROWTH_LIVE` is **off**, so everything is a test send or dry run.

**Tests:** outreach 17 files / 191 cases; growth 13 files / 57 cases.

---

## 3. AgentMail: real emails from the agents

- **Sender:** `ops@mail.operis.live` (DNS on Vercel; the main `operis.live` mail stays on Microsoft 365).
- **Job offers:** branded HTML in operis.live's Avenir look, plus a text version. Each has a **signed short link** (10 random characters, an 8-character HMAC tag, a 7-day expiry), the reason the person got it ("You asked us to send you jobs"), and **Reply STOP**.
- **Account emails:** login links and password resets for worker accounts use the same sender.
- **Safety:** `PAUSE_OUTREACH` sends nothing. Unless `OUTREACH_LIVE` is on, only the team allowlist gets real mail; everyone else is a dry run. At most 50 recipients per blast, and nobody is contacted twice for the same job.
- **Reply handling:** STOP / YES `<code>` / MORE / NO / questions are classified in `replies.ts`. **Built for SMS replies; inbound email replies aren't wired yet.**

---

## 4. Stripe: real money, live mode

**Products used** (`services/money-verification`, Cameron):
- **Checkout with manual capture (escrow).** The customer's card is held when they pay and captured only when proof passes. Idempotency keys go on every write.
- **Saved cards** (`setup_payment`, Checkout in setup mode). After that, `request_human` funds jobs directly, with **no human in the loop**. `payment.payment_method` also works per request.
- **Connect Express payouts.** The worker gets **75%** and Operis keeps 25%. On the first payout the worker gets an onboarding link, and the payout completes on `account.updated`.
- **Refunds:** full or partial, idempotent by `request_id`.
- **Identity:** a government ID plus a matching selfie, required for tier-2 jobs. The verified name is used for licence checks.
- **Disputes:** a chargeback wakes the Disputes agent. It drafts evidence, and submits only when told to.
- **Webhooks:** 13 event types across checkout, payment intents, refunds, disputes, identity and Connect accounts.
- **Live cutover:**
  - A restricted `rk_live_` key.
  - Two webhook secrets: the account endpoint and the Connect endpoint.
  - `livemode` columns, so test and live IDs never mix.
  - Live caps: `PAYOUT_CAP_CENTS=5000` and `DAILY_ESCROW_CAP_CENTS=10000`. Anything over a cap needs the **CEO agent's** approval (`release_payout_large` / `refund_large`).

**Licensed "connector" jobs** (notary, attorney): the worker keeps the whole budget, and the customer pays a tiered fee (20% / 10% / 5%).

**Tests:** 31 files / 407 cases.

---

## 5. Proof verification (Stripe Identity + vision)

Checks on every proof (`services/money-verification/src/proof`):
- **Geofence:** haversine distance, 150 m by default. Photo GPS is preferred, device GPS is the fallback.
- **GPS consistency:** photo and device GPS more than 150 m apart is flagged.
- **Time window:** the photo must be taken within the job's window.
- **Completeness:** enough photos, plus the required fields.
- **Media reuse:** an exact SHA-256 match against other jobs' photos.
- **Identity:** tier 2 only.
- **Vision score:** `claude-haiku-5.5` through Naïve's proxy confirms that each "must show" item appears in the photos.

**Tiers:**

| Tier | When | Confidence needed | Also required |
|---|---|---|---|
| 0 | under $50 | ≥ 0.80 | |
| 1 | $50 – $150 | ≥ 0.85 | photo time (EXIF) |
| 2 | over $150, or any licence | ≥ 0.90 | 2 photos, verified ID |

**Decisions:** a failed geofence or reused media **can never be approved**, even by a founder. A pass across the board is approved; anything else is escalated to the founder console. The founder's decision is recorded so the payout clears.

**Licence checks:** CA Secretary of State notary list (imported), and State Bar (calbar.ca.gov) for attorneys, matched against the worker's verified ID name.

**Liability policy:** L1 notary and L2 legal → connector; L3–L6 licensed trades, real estate, security and tax → refuse; D everything else → Operis holds the liability.

---

## 6. Neon (Postgres)

- **Setup:** Neon through the Vercel Marketplace integration on operis-api, with pooled connections and `prepare: false` for serverless.
- **Size:** **35 tables and 20 migrations** (plus `contracts/schema.sql`), applied by one idempotent `npm run db:migrate`.
- **What it holds:** jobs and their atomic state machine, customers and keys, OAuth, workers and the talent pool, outreach, proofs and reviews, ledger, liability, growth, worker accounts and sessions, agent events, idempotent wake events, and `api_calls`, the live log of every agent call.
- **Ledger:** a unique `idempotency_key` means a retried Stripe event never double-books money.

---

## 7. Vercel

- **Two projects in one team:**
  - `operis-web` (Dora's Next.js site): `operis.live`, `www`, `admin.operis.live`.
  - `operis-api` (Next.js API + MCP): `api.operis.live`.
- **Routing:** the website rewrites `/mcp`, `/api/*`, `/v1/*`, `/oauth/*`, `/.well-known/*`, `/llms.txt` and `/SKILL.md` to the API, so customers only ever see **operis.live**.
- **Crons:**
  - `/api/cron/sweep` every 5 minutes: overdue jobs → expire and refund; stuck outreach → wake Ops.
  - `/api/cron/approvals` every minute: auto-approve plus feed sync.
- **Blob** (`operis-proofs`): phones upload full-size proof photos straight to storage.
- **DNS** on Vercel (nameservers moved from GoDaddy), including the email records for M365 and AgentMail.
- **Scale:** 53 API routes and 29 web pages.

---

## 8. Google

- **Sign in with Google** for workers. A Google login links to an existing email account or creates a new one, and the email is marked verified.
- **Founders sign in to admin.operis.live with Google**, limited to the allowlisted emails.
- **Consent screen:** published, with `operis.live` verified through Search Console. Only the `openid email profile` scopes, so there's no "unverified app" warning. Our privacy policy follows Google's Limited Use rules.

---

## 9. MCP: how any agent hires a human

- **One command:** `set up https://operis.live/SKILL.md`. The agent signs itself up, asks its owner for an email, and calls Operis in the same session, with no restart and no browser.
- **OAuth 2.1 for MCP:** dynamic client registration and PKCE. Claude.ai, ChatGPT, Cursor and VS Code connect by pasting `https://operis.live/mcp` and signing in.
- **Also available:** a Claude Code plugin, a Naïve config, a curl path, and `/llms.txt`.
- **Built for agents to read:** tool results come with a `next_step`, `status_meaning` and the reason for any rejection. Guardrails keep jobs to San Francisco, at least $20, at least 15 minutes out, and free of banned tasks.
- **Directories:** MCP directories (Glama, MCP Yellow Pages, AgentRank, …) can read our server card and tool list without a key, so we get listed. Using a tool still needs a key.

---

## 10. The live backoffice (show this in the video)

`admin.operis.live`, founders only:
- **Tiles:** requests, in progress, needs review, paid, revenue (fees and worker payouts), companies, and **agent calls in the last 24 hours**.
- **Pipeline:** awaiting payment → funded → finding people → worker on it → proof in → approved → paid.
- **Calls from agents:** every MCP call, sign-up, OAuth connect, rejection and error, with the calling app (e.g. "claude-code 2.1"), plus a separate tab for directory crawlers.
- **Agent activity:** a live feed in plain words ("compliance used set_liability", "auto-approved a routine step").
- **Request details:** pipeline, worker, proof photos and the agent timeline.

---

## Suggested 3-minute arc

1. **The problem (10 s):** Naïve has 59 primitives for agents, and none of them can touch the physical world.
2. **The hire (30 s):** in Claude Code, `set up https://operis.live/SKILL.md`, then "photograph the Ferry Building clock". It calls `request_human`, and the job is funded from a saved card with no link.
3. **The company runs itself (60 s):** in the backoffice, the call appears, then Compliance → CEO → Ops on the agent feed. Monid finds people, and AgentMail sends the offer.
4. **The human (40 s):** the email arrives, the worker signs in with Google and accepts, then photographs on site with GPS.
5. **Trust and money (30 s):** the Verifier's vision check passes. Finance captures the payment through Stripe and pays the worker 75% through Connect. The revenue tile ticks up.
6. **Close (10 s):** "Operis: the human primitive for autonomous companies. Built on Naïve, run by Naïve."

## Be honest on camera
- SMS through Mobilerun is built but **not live** (email only).
- `GROWTH_LIVE` is off: Sales and Recruiter emails are test sends or dry runs.
- Outreach in demo mode emails only the team allowlist (`OUTREACH_LIVE=false`).
- The proof → payout leg has been tested in parts; record a full real run before the final cut.
