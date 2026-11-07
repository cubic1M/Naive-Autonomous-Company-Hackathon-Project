# Going live on operis.live

| Address | What | Project |
|---|---|---|
| `https://api.operis.live` | API, landing page with guide | Vercel project **operis-api** (root `apps/api`) |
| `https://api.operis.live/mcp` | **Public MCP server** other teams' agents connect to | same |
| `https://api.operis.live/llms.txt` | Guide for agents (plain markdown) | same |
| `https://operis.live` | Dora's web app: worker job pages `/j/[token]`, dashboard | Vercel project **operis-web** (root `apps/web`); until it exists, point it at operis-api |
| `sales@operis.live`, `ops@operis.live` | Agent inboxes (Naïve) | Naïve domain `dom_cargcf4dfrmk3mkrv09ksg6s19` |

---

## 1. Database (Neon), 5 min

1. console.neon.tech → New project `operis` (region: US West or US East).
2. Copy the **pooled** connection string (host contains `-pooler`).
3. Run migrations from your laptop:
   ```bash
   DATABASE_URL='postgres://…-pooler…/neondb?sslmode=require' npm run db:migrate
   ```
   You should see 4 ✓ lines (shared schema, Edwin's additions, self-serve customers, outreach).

## 2. API on Vercel, 10 min

1. vercel.com → Add New → Project → import `cubic1M/Naive-Autonomous-Company-Hackathon-Project`.
2. **Root Directory: `apps/api`**. Leave "Include files outside the root directory" **on**. Framework: Next.js (auto).
3. **Environment variables** (Production). Copy from `apps/api/.env.local`, with these production values:

   | Var | Value |
   |---|---|
   | `DATABASE_URL` | Neon pooled string |
   | `API_BASE_URL` | `https://api.operis.live` |
   | `PUBLIC_BASE_URL` | `https://operis.live` |
   | `NAIVE_API_KEY` | the **rotated** Naïve key |
   | `INTERNAL_MCP_KEY`, `LINK_SIGNING_SECRET`, `NAIVE_WEBHOOK_SECRET`, `CALLBACK_SIGNING_SECRET` | from `.env.local` (or generate new ones) |
   | `USE_MOCKS` | `true` for now (flip to `false` when real tools are ready) |
   | `MOCK_PAYMENTS` | `true` until Cameron's Stripe hold is in |
   | `MONID_API_KEY` | when you have it (turns on Andrew's real `find_people` / `send_blast`) |
   | `OUTREACH_LIVE` | `false` (dry run) until the demo |
   | `MOBILERUN_*`, `STRIPE_*`, `BLOB_READ_WRITE_TOKEN` | when each is ready |
   | `NAIVE_AGENT_*` | after step 4 |

4. Deploy. Then Project → Settings → **Domains** → add `api.operis.live`. Also add `operis.live` and `www.operis.live` (these move to operis-web when Dora deploys). Vercel shows the DNS records to create; use **its** values in step 3.

## 3. DNS at GoDaddy, 10 min (+ propagation)

GoDaddy → My Products → `operis.live` → **DNS** → Manage DNS.

**First delete** GoDaddy's default `A @ → Parked` record and the default `CNAME www → @` if present.

**Website and API (Vercel).** Use the exact values Vercel shows on the Domains page. They're usually:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `76.76.21.21` | 600 |
| CNAME | `www` | `cname.vercel-dns.com` | 600 |
| CNAME | `api` | `cname.vercel-dns.com` | 600 |

**Email for the agents (Naïve).** Exact values from Naïve for `operis.live`:

| Type | Name | Value | Priority |
|---|---|---|---|
| MX | `@` | `receive.forge.rmta.net` | 10 |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | |
| CNAME | `rsend` | `send.forge.rmta.net` | |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDOJlAhFuxlpRFQju1fuzRquKxa7YuIXqE06UqKluLFmehKQfiq8PydXyerrELR4V07HGoV16C3oRf4wYtCwtagoNMXYWEKMI+jYVUBzLfkoyrnJmf8xxoaAl2vg92hcPT1+hMBIVT358DW3jLzKUgH+jxURncG7sDDKLbiY+ifuQIDAQAB` | |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | |

GoDaddy wants the name **without** `.operis.live` (just `send`, `api`, `_dmarc`). Propagation is usually 5–30 minutes. Check with:
```bash
dig +short api.operis.live CNAME
dig +short operis.live MX
```

## 4. Connect the agents (after DNS resolves)

```bash
# point local config at production, then:
API_BASE_URL=https://api.operis.live npm run agents:setup -- --write-env
```
This creates the vault credential for `api.operis.live`, the 5 agents (Ops gets Andrew's `worker-sourcing@1` skill; `send_blast` = ask), the CEO team, the Naïve webhook, the daily report, and Ops' re-blast schedule (disabled until outreach is live). Copy the printed `NAIVE_AGENT_*` ids into Vercel env and redeploy. **Send the Ops id to Andrew.**

Then verify the email domain and create the inboxes: `POST /v1/domains/dom_cargcf4dfrmk3mkrv09ksg6s19/verify`, then identities "Operis Sales" / "Operis Ops" with inboxes `sales@operis.live` / `ops@operis.live` (`wake: true`, owned by the Sales / Ops agent). Put the Ops identity and inbox ids in `NAIVE_OPS_IDENTITY_ID` / `NAIVE_OPS_INBOX_ID` so Andrew's outreach email sends from ops@.

**Vendor webhooks:**
- Mobilerun → `https://api.operis.live/webhooks/mobilerun` (events `sms.received`, `sms.send.failed`), secret → `MOBILERUN_WEBHOOK_SECRET`
- Stripe → `https://api.operis.live/webhooks/stripe` (`checkout.session.completed`), secret → `STRIPE_WEBHOOK_SECRET`

## 5. Check it's live

- [ ] `curl https://api.operis.live/api/health` → `"ok": true`, tools listed as real or mock
- [ ] `https://api.operis.live` shows the landing page; `/llms.txt` shows the guide with `api.operis.live` URLs
- [ ] Self-serve key: `curl -X POST https://api.operis.live/v1/customers -H 'Content-Type: application/json' -d '{"name":"Test","contact_email":"you@x.com"}'` → `api_key`
- [ ] From another machine: `claude mcp add --transport http operis https://api.operis.live/mcp --header "Authorization: Bearer opk_…"`, then ask it to list tools → `request_human`, `get_job`, `cancel_job`
- [ ] `API=https://api.operis.live npm run smoke` → 20/20 (creates test jobs in prod; fine for now)
- [ ] One job through the real agents: `request_human`, then `npm run simulate -- <job_id>` with `API` pointed at prod

## 6. Tell other teams

Share **`https://api.operis.live/llms.txt`** (agents can read it directly) or [`docs/CONNECT.md`](CONNECT.md). It covers getting a key, connecting from Claude Code, Cursor, Naïve or raw JSON-RPC, the tool reference, the job lifecycle and the rules. The Sales agent can email the same link from sales@operis.live.
