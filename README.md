# Operis

> 🗺️ **New here? Start with [docs/FLOW.md](docs/FLOW.md)**: the full job flow, who owns each step, and which folder your edits go in.
>
> 🤖 **Want your agent to hire a human?** Get a key at **https://operis.live/developers**, or read [docs/CONNECT.md](docs/CONNECT.md) (live at https://operis.live/llms.txt).
>
> 🧪 **Testing?** [docs/TEST_PLAN.md](docs/TEST_PLAN.md) · 🚀 **Running it in production?** [docs/GO_LIVE.md](docs/GO_LIVE.md)

## Live

| URL | What |
|---|---|
| https://operis.live | Website (Dora's app): home, worker job pages `/j/<token>`, `/jobs`, `/dashboard` |
| https://operis.live/developers | **Agent companies**: self-serve API key, connect instructions, copy-paste agent prompt, key test |
| https://operis.live/backoffice | **Founders**: live requests by company, agent activity, proofs (admin key) |
| https://operis.live/mcp | **Public MCP server** (`request_human`, `get_job`, `cancel_job`), proxied to the API |
| https://operis.live/llms.txt | Guide for agents |
| https://api.operis.live | API directly (MCP, REST, webhooks); founder console at `/admin` |

**Use Operis from Claude Code** (MCP server + "hire-a-human" skill), with `OPERIS_API_KEY` from https://operis.live/developers in your environment:

```
/plugin install operis --marketplace cubic1M/Naive-Autonomous-Company-Hackathon-Project
```

**Humans on demand for autonomous companies.**
An AI-run company asks for a human through our MCP server. Operis finds the right people online, reaches them through contact info they already publish, and pays whoever finishes the job. Workers never have to sign up in advance.

> Built at the Naïve × YC Autonomous Companies Hackathon. Operis is itself an autonomous company: six Naïve agents (CEO, Ops, Verifier, Finance, Sales, Disputes) run it in the **Operis** Naïve org, and the founders only set limits and approve big decisions.

---

## How it works

```
Autonomous company ──MCP──▶ Operis API ──▶ Naïve agents (CEO, Ops, Verifier, Finance)
                                                 │
                                   1. find people near the job (web scraping)
                                   2. message them via their public contact
                                                 ▼
                              Human clicks link ──▶ Operis job page
                                                 │  Accept / Decline
                                                 │  Upload proof (photo / video / file)
                                                 ▼
                              Verifier checks proof ──▶ Customer charged ──▶ Worker paid
```

1. **Request.** A customer agent calls `request_human` on our MCP server with the task, location, deadline, budget, any certification needed, and what proof it wants.
2. **Safety check.** We reject illegal, identity-faking, surveillance or licensed work. Borderline requests go to a founder.
3. **Hold payment.** The customer's card is held, not charged (Stripe, manual capture).
4. **Find people.** The scraper looks for people near the job on public, work-related sources: gig boards, campus job boards, business listings, and past workers.
5. **Reach out.** We message many people at once using contact info they published themselves (email, SMS, etc.), with a link to the job page. The first person to accept gets the job. Every message includes an opt-out.
6. **Job page.** The human sees the job description, pay, location and required certification, and clicks **Yes** or **No**. If needed, they upload extra info such as a certification.
7. **Proof.** When they're done, they upload the proof the job asked for: photos, video or documents, with GPS and a timestamp.
8. **Verify.** The Verifier agent checks the proof against the request. It approves if it's confident; otherwise a human reviewer decides.
9. **Pay.** The customer's card is charged. The worker connects a bank account once, on their first payout, and receives their share. We keep the fee.

## Money

- **Workers pay nothing.** No signup, no fees.
- **Customers pay only for finished jobs.** The card is held up front and charged only when proof passes. If the job fails, the hold is released.
- **Our cut:** 25% of the job price ($20 minimum job). Example: a $60 job pays the worker $45, and Operis keeps $15.

## MCP tools (for customer agents)

| Tool | What it does |
|---|---|
| `request_human` | Post a job: task, location, deadline, budget, certification, proof requirements |
| `get_job` | Status, plus the proof package once approved |
| `cancel_job` | Cancel before someone accepts |

Example request:

```json
{
  "title": "Hold a sign near the YC office",
  "instructions": "Hold our sign at the corner for 2 hours, 12-2pm.",
  "location": { "address": "YC, San Francisco, CA", "lat": 37.7749, "lng": -122.4194 },
  "deadline": "2026-11-08T14:00:00-08:00",
  "budget_usd": 60,
  "certification_required": null,
  "proof": { "photos": { "min": 2, "must_show": ["person holding sign", "street corner"] }, "geofence_m": 150 }
}
```

## The agent team (Naïve)

| Agent | Job |
|---|---|
| **CEO** | Owns the board, assigns every job, P&L, disputes, daily report to founders |
| **Ops** | Runs the scraper, sends outreach, picks the worker who accepts |
| **Verifier** | Checks proof (vision model + GPS); approves or escalates |
| **Finance** | Holds, charges, payouts, refunds, ledger |
| **Sales** | Gets other teams' agents connected to our MCP server |

**Limits set by the founders:** a daily spend cap per agent; refunds and payouts over $150 need the CEO agent's approval; anything over $1,000, or any legal or safety issue, goes to a founder; jobs only within the demo area (San Francisco).

## Team split

| Role | Owner | Builds |
|---|---|---|
| **Frontend** | Dora | The worker website: job page (description, pay, certification, Yes/No), upload forms, proof upload with GPS, payout setup screen, plus the live dashboard (map, live job, agent feed, money) |
| **Scraping & outreach** | Andrew | Finding people near a location, extracting public contact info, sending the "blast" (email / SMS), first-yes-wins logic, the regulars list |
| **Verification & payouts** | Cameron | Proof checks (GPS distance, timestamp, image/video review with a vision model), approve/escalate flow, Stripe hold → charge → payout to bank |
| **Naïve agents & MCP** | Edwin | The MCP server and API, database, the five Naïve agents (prompts, budgets, tool permissions, team board), and wiring everything together |

**Shared contract:** everyone builds against the same `jobs` / `workers` / `proofs` tables and the job states below. Change them only after agreeing as a team.

```
requested → held → outreach → accepted → proof_submitted → approved → paid
                                                         ↘ escalated / rejected
(also: cancelled, expired, refunded)
```

## Stack

| Layer | Tool |
|---|---|
| Agents | Naïve Managed Agents (`@usenaive-sdk/managed-agents`, `naive` CLI) |
| API + MCP server | TypeScript on Vercel (`@modelcontextprotocol/sdk`) |
| Database | Postgres (Neon, or a Naïve fullstack app) |
| Payments + payouts | Stripe Checkout (manual capture) + Stripe Connect Express |
| Messaging | Twilio SMS + email via Naïve inboxes |
| Proof storage | Vercel Blob (or Naïve app storage) |
| Vision | A vision model via Naïve's model router |

## Rules we follow

- **Only public, work-related contact info.** We don't buy or dig up personal data. Everyone we message can opt out, and once they do, we never contact them again.
- **No identity work.** Humans never sign contracts, pass CAPTCHAs, receive OTPs or pretend to be the agent.
- **No licensed advice sold as ours.** If a job needs a certification, the worker shows it, and they do the work in their own name.
- **Every job is verified.** GPS, a timestamp and proof are required before money moves.

## Getting started

```bash
npm install                                   # repo root: npm workspaces (apps/*, services/outreach, services/money-verification)
docker run -d --name operis-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=operis -p 55433:5432 postgres:17
cp apps/api/.env.example apps/api/.env.local  # fill in secrets (see apps/api/README.md)
npm run db:migrate                            # all migrations (shared schema, API, outreach, money-verification)
npm run dev                                   # API on http://localhost:3001
cd apps/web && cp .env.example .env.local && npx next dev -p 3100   # website on http://localhost:3100 (proxies /api → :3001)
npm run smoke                                 # 20 end-to-end checks against the API
```

Useful scripts: `npm run approvals` (founder approvals for Naïve agents), `npm run agents:setup` (apply `agents/agents.json` to Naïve), `npm run simulate -- <job_id>` (play the worker), `npm run customer:create`.

Full flow, ownership and build order: [docs/FLOW.md](docs/FLOW.md). Shared contracts: [contracts/](contracts/). Production setup: [docs/GO_LIVE.md](docs/GO_LIVE.md).
