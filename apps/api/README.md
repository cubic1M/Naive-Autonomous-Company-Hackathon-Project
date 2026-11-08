# apps/api (Edwin)

The MCP server, REST API and webhooks: the hub everything plugs into. Flow: [docs/FLOW.md](../../docs/FLOW.md) · Plan: [docs/plans/edwin.md](../../docs/plans/edwin.md).

## Run it locally (5 minutes)

```bash
# from the repo root
npm install
docker run -d --name operis-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=operis -p 55433:5432 postgres:17
cp apps/api/.env.example apps/api/.env.local     # then fill INTERNAL_MCP_KEY (openssl rand -base64 32)
npm run db:migrate                               # contracts/schema.sql + migrations/002_edwin.sql
npm run dev                                      # http://localhost:3001  (health: /api/health)
npm run smoke                                    # 20 checks: every tool, worker endpoints, guardrails
```

`/api/health` shows which tools are **real** and which are **mock**.

## Deploy (Vercel + Neon)

1. **Neon:** create a project and copy the **pooled** connection string into `DATABASE_URL`, then run `DATABASE_URL=… npm run db:migrate`.
2. **Vercel:** import the repo, set **Root Directory = `apps/api`**, keep "Include files outside the root directory" **on** (we import `contracts/` and `services/`), and add the env vars from `.env.example`.
3. Set `PUBLIC_BASE_URL` to the deployed URL, then run `npm run agents:setup -- --write-env` to create the Naïve team pointed at it. Copy the printed `NAIVE_AGENT_*` ids into Vercel env and redeploy.

## Endpoints

| Path | Who calls it | What |
|---|---|---|
| `POST /mcp` | Customer agents (`Bearer opk_…`) | `request_human`, `get_job`, `cancel_job` |
| `POST /mcp/internal` | Our Naïve agents (`Bearer INTERNAL_MCP_KEY`, or `?key=`) | 10 agent tools (mock or real) |
| `GET /v1/worker/jobs/:token` | Dora's job page | Job details, `can_accept`, `can_upload_proof` |
| `POST /v1/worker/jobs/:token/accept` · `/decline` | Dora's job page | First yes wins (409 if taken) |
| `POST /v1/worker/jobs/:token/proof` | Dora's proof page | JSON `{media, gps_lat, gps_lng, captured_at}` or multipart `files[]` (needs Blob) |
| `POST /v1/worker/payout-setup` | Dora's payout page | `{token}` → Stripe Connect link (Cameron's `createPayoutLink`) |
| `POST /v1/customers` | Agent companies (self-serve) | `{name, contact_email}` → `opk_…` key (5 per IP per hour) |
| `GET /v1/dashboard` | Dora's dashboard (admin key) | Active job, jobs, wake timeline, agent feed, money |
| `GET /v1/admin/requests` | Backoffice (admin key) | Every request with company, agent activity, wake-ups, proof |
| `GET/POST /v1/admin/escalations[/:jobId]` | Founder console (admin key) | Proofs waiting for a founder; approve → pay, reject → refund |
| `GET/POST /v1/admin/approvals` | Founder console (admin key) | Naïve tool approvals waiting; allow once / for the session / deny |
| `POST /v1/worker/identity` | Job page (tier-2 jobs) | `{token}` → Stripe Identity link |
| `GET /v1/files/:id` | Anyone with the URL | Proof files stored in Postgres when Blob isn't used |
| `GET /api/cron/sweep`, `/api/cron/approvals` | Vercel cron (`CRON_SECRET`) | Expiry + no-taker nudges; agent feed + auto-approve |
| `GET /admin` | Founders (`?key=ADMIN_KEY` once) | Founder console: agent approvals, escalated proofs, numbers |
| `POST /webhooks/stripe` | Stripe | `checkout.session.completed` → job `held` → CEO wakes |
| `POST /webhooks/mobilerun` | Mobilerun | `sms.received`: `YES 1234` / `NO 1234` / `STOP` |
| `POST /webhooks/naive?k=…` | Naïve | Agent events → `agent_events` (dashboard feed) |
| `GET /api/health` | Us | DB check + real/mock per tool |

## Where things live

```
src/
├── app/                 routes (above)
├── mcp/server.ts        stateless MCP over HTTP (SDK web-standard transport)
├── mcp/schemas.ts       zod input schemas (mirror contracts/tools.ts)
├── tools/edwin.ts       request_human, get_job, cancel_job (always real)
├── tools/mocks.ts       contract-shaped mocks that also move job state
├── tools/registry.ts    real (services/*) vs mock per tool: USE_MOCKS, MOCK_TOOLS
└── lib/
    ├── db.ts            postgres client + atomic transitionJob()
    ├── jobs.ts          transition() = transitionJob + wake + customer callback
    ├── naive.ts         wake(): the ONLY caller of Naïve POST /v1/sessions (idempotent)
    ├── messaging.ts     sendSms(): Mobilerun → Monid AgentLine fallback, logged
    ├── mobilerun.ts     SMS send + webhook signature check
    ├── monid.ts         discover / inspect / run
    ├── safety.ts        abuse filter · geo.ts geofence · auth.ts keys · callbacks.ts · worker.ts
```

## For Andrew and Cameron: plugging in a real tool

Export it from `services/<area>/index.ts` with the type from `contracts/runtime.ts`:

```ts
import type { ToolImpl, ServiceModule } from "../../contracts/runtime";
export const find_people: ToolImpl<"find_people"> = async ({ job_id, limit }, ctx) => {
  const [job] = await ctx.sql`select lat, lng from jobs where id = ${job_id}`;
  const found = await ctx.monid.run("provider", "/endpoint", { /* … */ });
  // … upsert workers, return { candidates: [...] }
};
export default { find_people } satisfies ServiceModule;
```

`ctx` gives you `sql`, `transition(jobId, to, patch)` (validated, and it wakes the next agent), `sendSms`, `monid`, `ledger`, and `baseUrl`. Once your tool is exported it's served as **real** automatically; `MOCK_TOOLS=find_people` rolls it back. Run `npm run smoke` after every change.

Cameron can also export `createHold(jobId) → { escrow_url }` (used by `request_human` when `MOCK_PAYMENTS` is off) and `createPayoutLink(workerId) → { url }`.
