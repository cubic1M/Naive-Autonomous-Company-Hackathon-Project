# Outreach × Naïve: integration plan

**Approved by Andrew (2026-11-08):** fully autonomous. Skill `worker-sourcing@2` + tools on Ops, `find_people` = allow, `send_blast` = **allow** (no human approval). Real sends are gated in code: `OUTREACH_LIVE=true` emails everyone; otherwise only `OUTREACH_TEST_ALLOWLIST` (demo mode). Manual DM queue off (`OUTREACH_MANUAL_QUEUE=false`).

## 1. Skill: teach the Ops agent how to source workers

File: [`agents/skills/worker-sourcing/SKILL.md`](../../../agents/skills/worker-sourcing/SKILL.md)

```bash
naive skill push --slug worker-sourcing --file agents/skills/worker-sourcing/SKILL.md
```

Attach to Ops (pinned): `skills: ["worker-sourcing@1"]` in `agents/agents.json`. Changing skills creates a new Ops version, so re-pin the CEO's team roster afterwards (`naive team set ...`).

## 2. Tools on the Ops agent

Tools come from our internal MCP server (`name: "operis"`), so the agent sees them as `operis.<tool>`.

```jsonc
// agents/agents.json → ops.tools.configs (Edwin's file; default_config is deny)
"operis.get_job":     { "enabled": true, "permission": "allow" },
"operis.find_people": { "enabled": true, "permission": "allow" },  // spend capped server-side (OUTREACH_MAX_SPEND_USD)
"operis.send_blast":  { "enabled": true, "permission": "allow" }   // approved: fully autonomous
```

Why these are safe: the limits are enforced in code, not in the prompt.
- `find_people` stops paid calls at `OUTREACH_MAX_SPEND_USD` (default $0.25 per call) and logs `scrape_cost` to the ledger.
- `send_blast` never messages opted-out people, never double-messages, never cold-SMSes, and sends nothing real unless `OUTREACH_LIVE=true` (allowlisted test contacts excepted). `PAUSE_OUTREACH=true` stops all sending.

## 3. Wiring in apps/api (Edwin)

```ts
import postgres from 'postgres';
import { envFromProcess, HttpMonid, PostgresRepo, NaiveEmailSender, outreachTools, verifyJobToken, handleReply } from '../../../services/outreach/src/index.js';

const env = envFromProcess();
const repo = new PostgresRepo(postgres(process.env.DATABASE_URL!));
const deps = {
  repo, env,
  monid: new HttpMonid(env.MONID_API_KEY, env.MONID_BASE_URL),
  email: new NaiveEmailSender({ apiKey: env.NAIVE_API_KEY!, baseUrl: env.NAIVE_BASE_URL, identityId: env.NAIVE_OPS_IDENTITY_ID!, inboxId: env.NAIVE_OPS_INBOX_ID! }),
  sms: { send: (to: string, body: string) => sendSms(to, body) }, // lib/messaging.ts
};
for (const t of outreachTools(deps)) server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema }, t.handler);
```

Edwin's API must also:
- Run `services/outreach/migrations/0001_outreach.sql` after `contracts/schema.sql`.
- On `/j/[token]`: `verifyJobToken(token, LINK_SIGNING_SECRET)` returns `{ job_id, worker_id }` or null. Accept with first-yes-wins.
- Move the job `held → outreach` when Ops starts outreach (`send_blast` requires `held` or `outreach` but doesn't transition).
- Inbound SMS (`/webhooks/mobilerun`): call `handleReply({ channel: 'sms', from, text }, { repo })` and send back `reply_text` if set. `accept_requested` returns the code for the API to verify.
- Inbound email to ops@ wakes Ops (Naïve does this). Ops follows the skill. Optionally expose `handleReply` as an internal tool later.

## 4. Re-blast schedule (optional)

Ops agent (Operis org): `agt_zzy6h6r9pnrad5aqnvkdhsyjhp`. On Vercel this is `NAIVE_AGENT_OPS`.

A Naïve deployment on Ops every 10 minutes: "Any job in `outreach` for 15+ minutes with no accept? Follow the worker-sourcing skill's 'If nobody accepts' steps."

```bash
naive deploy create --agent agt_zzy6h6r9pnrad5aqnvkdhsyjhp --cron "*/10 * * * *" --budget-usd 0.5 --prompt "Check jobs stuck in outreach and follow the worker-sourcing skill."
```

## 5. Env vars (Vercel)

`MONID_API_KEY`, `PUBLIC_BASE_URL`, `LINK_SIGNING_SECRET`, `NAIVE_API_KEY`, `NAIVE_OPS_IDENTITY_ID`, `NAIVE_OPS_INBOX_ID`, `OUTREACH_MAX_SPEND_USD=0.25`, `OUTREACH_RADIUS_KM=8`, `OUTREACH_LIVE=false` (flip to `true` for real sends), `OUTREACH_TEST_ALLOWLIST=<our own emails/phones>`, `PAUSE_OUTREACH=false`.
