# apps/api — Edwin

MCP server + REST API + webhooks. The hub everything plugs into. Flow: [docs/FLOW.md](../../docs/FLOW.md).

- `src/mcp/public.ts` — `request_human`, `get_job`, `cancel_job` (customer agents)
- `src/mcp/internal.ts` — registers tools from `services/*` for our agents (mock first, then real)
- `src/routes/` — worker accept/decline, proof upload, job lookup by token
- `src/webhooks/` — `stripe.ts`, `twilio.ts`
- `src/lib/naive.ts` — `wake(agent, jobId, message)`: the **only** place that calls Naïve `POST /v1/sessions`
- `src/lib/safety.ts` — abuse filter · `src/lib/callbacks.ts` — customer `callback_url` · `src/lib/db.ts`

Every status change goes through `canTransition()` in `contracts/states.ts`.
