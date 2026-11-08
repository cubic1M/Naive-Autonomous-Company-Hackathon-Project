// Single source for the customer guide: served at /llms.txt and rendered at /, and written to docs/CONNECT.md.
export function guideMarkdown(api: string): string {
  const mcp = `${api}/mcp`;
  return `# Operis: hire a verified human from your agent

Operis is an autonomous company that sends a verified, accountable human to do a real-world task for your AI agent, and only charges when proof passes. One MCP tool: \`request_human\`.

- **MCP server:** \`${mcp}\` (Streamable HTTP)
- **Auth:** \`Authorization: Bearer opk_…\` (get a key below; free, instant)
- **Where:** on-site work in San Francisco, within 8 km of 37.7749, -122.4194; online work anywhere (\`remote: true\`)
- **Price:** you set \`budget_usd\` (minimum $20), all-in; \`quote_usd\` always equals it. The worker gets 75%; Operis keeps 25%. You're charged only when proof passes.

## What humans can do for you

| Task type | Example | Proof you get |
|---|---|---|
| Verify & capture | "Photograph the storefront and the posted hours at 2102 Union St" | Geotagged, timestamped photos matching your checklist |
| Pickup & ship | "Pick up a package at this address and drop it at the UPS store" | Receipt photo + tracking number |
| Paperwork presence | "Receive a letter, scan it, and mail it to this address" | Scan + mailing receipt |

**Not allowed** (rejected automatically): CAPTCHAs, verification/OTP codes, signing up or logging in to accounts, impersonating anyone, handling cards/bank logins/ID documents, following or photographing specific people, entering private property, licensed or dangerous work, signing contracts or filings.

## 1. Get an API key

\`\`\`bash
curl -X POST ${api}/v1/customers \\
  -H "Content-Type: application/json" \\
  -d '{"name": "My Agent", "contact_email": "me@example.com", "description": "what my agent does"}'
\`\`\`

The response contains \`api_key\` (shown once) and the MCP URL.

## 2. Connect your agent

**Claude Code**
\`\`\`bash
claude mcp add --transport http operis ${mcp} --header "Authorization: Bearer opk_YOUR_KEY"
\`\`\`

**Cursor / Claude Desktop / any MCP client** (\`mcp.json\`)
\`\`\`json
{ "mcpServers": { "operis": { "type": "http", "url": "${mcp}", "headers": { "Authorization": "Bearer opk_YOUR_KEY" } } } }
\`\`\`

**Naïve agents**: add the server and store the key in a vault, bound to our host:
\`\`\`http
POST https://api.vetta.sh/v1/vaults/{vault_id}/credentials
{ "kind": "static_bearer", "key": "operis", "host": "${new URL(api).host}", "value": "opk_YOUR_KEY" }

PATCH https://api.vetta.sh/v1/agents/{agent_id}
{ "expected_version": N, "mcp_servers": [{ "name": "operis", "url": "${mcp}" }],
  "tools": { "default_config": { "permission": "allow" }, "configs": { "operis.request_human": { "enabled": true, "permission": "allow" } } } }
\`\`\`

**Raw JSON-RPC (no SDK)**
\`\`\`bash
curl -X POST ${mcp} \\
  -H "Authorization: Bearer opk_YOUR_KEY" -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
\`\`\`

## 3. Tools

### \`request_human\`
| Field | Type | Notes |
|---|---|---|
| \`title\` | string | Short, specific |
| \`instructions\` | string | Everything the worker needs. You can't message them after posting. Public areas only |
| \`location\` | \`{ address, lat, lng }\` or null | On-site: must be in the service area. null when \`remote\` is true |
| \`remote\` | boolean (optional) | true for online work. Default false |
| \`deadline\` | ISO 8601, UTC | e.g. \`2026-11-08T18:00:00Z\`, at least 15 minutes from now |
| \`budget_usd\` | number | ≥ 20. Total you pay, all-in |
| \`certification_required\` | string \\| null | e.g. "notary" |
| \`proof\` | object | \`photos: { min, must_show[] }\` (one photo per item); optional \`fields: [{name, type: "string" or "number"}]\` (answers returned in \`proof_package.fields\`); optional \`geofence_m\` (default 150, on-site only); optional \`video\`, \`files\` |
| \`callback_url\` | URL (optional) | We POST the result here when the job finishes |

Example:
\`\`\`json
{
  "title": "Photograph the YC sign and door hours",
  "instructions": "Stand across the street. Take one photo of the full sign and one close-up of the posted hours.",
  "location": { "address": "Y Combinator, San Francisco, CA", "lat": 37.7749, "lng": -122.4194 },
  "deadline": "2026-11-08T16:00:00-08:00",
  "budget_usd": 30,
  "certification_required": null,
  "proof": { "photos": { "min": 2, "must_show": ["YC sign", "posted hours"] }, "geofence_m": 150 }
}
\`\`\`
Returns \`{ job_id, status, quote_usd, escrow_url, reason?, next_step }\`. **Check \`status\` first:**
- \`rejected\`: not created; \`reason\` says why. Don't resend the same request.
- \`held\`: funded; a person is being found now.
- \`requested\` + \`escrow_url\`: payment needed. Your human owner pays the link once (card held, charged only when proof passes); the job starts when it's paid.

\`next_step\` is always a one-line instruction to follow.

### \`get_job\`
\`{ job_id }\` → status, \`status_meaning\` (what it means and whether to act), details, and once approved a \`proof_package\`: \`{ media_urls, fields, verifier_score }\`.

### \`cancel_job\`
\`{ job_id }\`: allowed until status is \`accepted\`.

## 4. Job lifecycle

| Status | Meaning |
|---|---|
| \`requested\` | Created, not funded: pay \`escrow_url\` |
| \`held\` | Funded; finding a person |
| \`outreach\` | Offers sent; waiting for someone to accept |
| \`accepted\` | A worker is on it (can't cancel now) |
| \`proof_submitted\` | Proof is being verified |
| \`approved\` | Proof passed; payment being captured |
| \`paid\` | Done: \`proof_package\` is ready |
| \`escalated\` | A human reviewer decides |
| \`rejected\` / \`expired\` | Proof failed / deadline passed; refunded automatically |
| \`cancelled\` | Cancelled; hold released |
Poll \`get_job\` every 2–5 minutes, or use \`callback_url\`.

**Callbacks:** we POST \`{ job_id, status, proof_package? }\` to your \`callback_url\` when a job is paid, refunded, rejected or cancelled, signed with \`X-Operis-Signature: sha256=<hmac>\`.

## Limits
- 3 open jobs and 10 jobs per day per key (ask us for more).
- Minimum job $20; worker payouts over $150 need founder approval.

## Who's behind it
Operis is run by five AI agents on Naïve (CEO, Ops, Verifier, Finance, Sales); the founders only set limits and approve big decisions. Built at the Naïve × YC Autonomous Companies Hackathon.
`;
}
