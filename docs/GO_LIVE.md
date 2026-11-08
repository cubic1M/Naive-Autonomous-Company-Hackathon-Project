# Operis in production

How production is wired today, and how to change or rebuild it. Owner: Edwin.

## Map

| Address | Served by | Notes |
|---|---|---|
| `https://operis.live` (+ `www`) | Vercel project **operis-web** (root `apps/web`) | Dora's site. Rewrites `/api/*`, `/mcp`, `/llms.txt`, `/v1/*`, `/webhooks/*` to the API |
| `https://api.operis.live` | Vercel project **operis-api** (root `apps/api`) | API, MCP servers, webhooks, crons, founder console `/admin` |
| Database | **Neon** `operis-db` (Vercel Marketplace integration on operis-api) | `DATABASE_URL` set by the integration (pooled) |
| Proof photos | **Vercel Blob** `operis-proofs` (public, sfo1) on operis-web | `BLOB_READ_WRITE_TOKEN`; phones upload originals straight to Blob |
| Agents | **Naïve**, org **Operis** | 6 agents from `agents/agents.json` (`npm run agents:setup`) |
| DNS | **Vercel DNS** (nameservers `ns1/ns2.vercel-dns.com`) | Website/API records are automatic; email records below |
| Email | `@operis.live`: Microsoft 365 (Outlook). `@mail.operis.live`: AgentMail (Andrew's outreach sender `ops@mail.operis.live`) | Restore/recreate with `scripts/dns-restore-m365.sh`, `scripts/dns-agentmail.sh` |
| Payments | **Stripe** (test mode) | Cameron's `services/money-verification`; webhook `https://api.operis.live/webhooks/stripe` |
| People search | **Monid** (`MONID_API_KEY`) | Wallet must have credit: https://app.monid.ai/wallet |

Both Vercel projects live in the **Host Engineer** team. Deploys are made from the repo root (the API imports `contracts/` and `services/`):
```bash
npx vercel deploy --prod --yes                                                        # API (root is linked to operis-api)
VERCEL_ORG_ID=team_MzpxNSNWXaxrfns5sZ2S6ZrN VERCEL_PROJECT_ID=prj_muMT6UwKIRPVApCW7mjmVfFv5YAD npx vercel deploy --prod --yes   # web
```

## Environment variables

**operis-api**: `DATABASE_URL` (Neon), `API_BASE_URL=https://api.operis.live`, `PUBLIC_BASE_URL=https://operis.live` (worker links), `NAIVE_API_KEY` (Operis org), `NAIVE_AGENT_{CEO,OPS,VERIFIER,FINANCE,SALES,DISPUTES}`, `INTERNAL_MCP_KEY`, `LINK_SIGNING_SECRET`, `NAIVE_WEBHOOK_SECRET`, `CALLBACK_SIGNING_SECRET`, `ADMIN_KEY`, `CRON_SECRET`, `MONID_API_KEY`, `AGENTMAIL_INBOX=ops@mail.operis.live`, `OUTREACH_LIVE` (`false` = demo mode: only `OUTREACH_TEST_ALLOWLIST` is really emailed), `OUTREACH_TEST_ALLOWLIST`, `OUTREACH_MAX_SPEND_USD`, `USE_MOCKS=false`, `MOCK_PAYMENTS=false`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (Cameron, sensitive), `VERIFIER_BASE_URL=https://api.vetta.sh/v1/proxy/openai/v1`, `VERIFIER_API_KEY` (Naïve key), `VERIFIER_MODEL=anthropic/claude-haiku-5.5`, limits (`MAX_OPEN_JOBS_PER_CUSTOMER`, `MAX_JOBS_PER_CUSTOMER_PER_DAY`, `MAX_JOBS_PER_DAY`, `GEOFENCE_*`), optional `AUTO_APPROVE_TOOLS`.

**operis-web**: `API_URL=https://api.operis.live`, `NEXT_PUBLIC_MCP_URL=https://operis.live/mcp`, `BLOB_READ_WRITE_TOKEN` (Blob store), optional `NEXT_PUBLIC_WORKER_LOGIN=required` once worker accounts exist.

Kill switches: `PAUSE_OUTREACH=true` (no messages), `OUTREACH_LIVE=false` (dry run), `MOCK_TOOLS=a,b` (force a tool back to its mock), `USE_MOCKS=true` (all mocks).

## Scheduled work (operis-api `vercel.json`)

| Path | Every | Does |
|---|---|---|
| `/api/cron/sweep` | 5 min | Overdue jobs → cancelled / expired + refunded; jobs stuck in outreach wake Ops at 15 and 45 min |
| `/api/cron/approvals` | 1 min | Pulls agent activity from Naïve into the feed; applies `AUTO_APPROVE_TOOLS` (off unless set) |

Plus a Naïve deployment: the CEO's daily report at 08:00 PT.

## Naïve agents

- Applied from `agents/agents.json` + `agents/prompts/*.md` with `API_BASE_URL=https://api.operis.live npm run agents:setup`. Safe to re-run; it re-binds the vault key, updates agents (new versions), re-pins the CEO's team, and registers the webhook.
- Ops loads Andrew's skill `worker-sourcing@2` (upload with `POST /v1/skills` + `/versions` in the Operis org).
- **Approvals:** Naïve pauses calls it flags `read_people` (find_people, board_write with an assignee, approve_proof, payouts...) for a human even when set to `allow`. Approve from the founder console (`https://api.operis.live/admin?key=…` → Agent approvals) or `npm run approvals -- allow-all --session`. Founder emails go to `FOUNDER_EMAIL`.
- The team originally lived in the "meaning of life" org; `scripts/cleanup-old-naive-org.sh` removes it from there.

## Rebuilding from scratch (order matters)

1. Neon: create the DB (Vercel → operis-api → Storage → Neon), then `DATABASE_URL=… npm run db:migrate`.
2. operis-api: set the env above, deploy, add domain `api.operis.live`.
3. Naïve (Operis org): create an admin key → `NAIVE_API_KEY`; upload the skill; `npm run agents:setup -- --write-env`; copy the `NAIVE_AGENT_*` ids to Vercel; redeploy.
4. operis-web: create the project (root `apps/web`), set its env, create the Blob store, deploy, add `operis.live` + `www` (`scripts/move-domain-to-web.sh` if they're on operis-api).
5. Stripe (Cameron): webhook → `https://api.operis.live/webhooks/stripe` with `checkout.session.completed`, `payment_intent.canceled`, `charge.refunded`, `refund.created`, `refund.updated`, `account.updated`, `charge.dispute.*`, `identity.verification_session.*`.
6. DNS email records: `scripts/dns-restore-m365.sh`, `scripts/dns-agentmail.sh`.
7. Run [TEST_PLAN.md](TEST_PLAN.md).
