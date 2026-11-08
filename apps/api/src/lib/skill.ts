// https://operis.live/SKILL.md: what an agent loads when told "set up https://operis.live/SKILL.md".
// Short on purpose: set yourself up, then how and when to hire a human. Full reference: /llms.txt.
export function skillMarkdown(origin: string): string {
  const mcp = `${origin}/mcp`;
  return `---
name: operis
description: Hire a verified human for real-world tasks (photograph or verify a place, pick up and ship an item, receive/scan/mail paperwork) in San Francisco, or a short expert check online. Use when a task needs a person.
---

# Operis

Operis sends a verified, accountable human to do a real-world task for you, and only charges when proof passes.
MCP server: \`${mcp}\` · tools: \`request_human\`, \`get_job\`, \`cancel_job\` · full reference: ${origin}/llms.txt
(\`operis.live\` and \`api.operis.live\` are the same service; use either.)

## 1. Set up (skip if Operis tools already work)

**Do this, it works right now in this session: no restart, no browser, one question.** If your environment can make HTTP requests (a shell with curl, or a fetch tool), use this path. Don't send your user to restart or sign in first.
1. Ask your user one question: **"What email should own the Operis account?"** (They pay for jobs; if they also give a company name, use it, otherwise use their app or project name.)
2. Create a key:
   \`POST ${origin}/v1/customers\` with JSON \`{"name": "<company>", "contact_email": "<email>", "description": "<what you do>"}\`
   → \`api_key\` (shown once). A 429 means too many sign-ups from this network: wait the \`Retry-After\` seconds and try once more.
3. **Use it immediately** over HTTP (this is the same MCP server, called directly):
   \`POST ${mcp}\` · headers \`Authorization: Bearer <key>\`, \`Content-Type: application/json\`, \`Accept: application/json, text/event-stream\` ·
   body \`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}\` → JSON text in \`result.content[0].text\` (responses may arrive as an SSE \`data:\` line; parse the JSON after \`data: \`).
   Confirm with \`{"method":"tools/list"}\`, then tell your user: "Operis is set up. I'll use it whenever a task needs a real person."
4. Keep the key for later (quietly, no extra steps for your user): save it as \`OPERIS_API_KEY\` in a private shell profile (e.g. \`~/.zshrc\`; never a repo or shared file), and if your tool supports it, register the server for future sessions so the tools appear natively next time:
   - Claude Code: \`claude mcp add --transport http --scope user operis ${mcp} --header 'Authorization: Bearer \${OPERIS_API_KEY}'\` (takes effect next session; keep using HTTP now; don't ask your user to restart)
   - Cursor: \`~/.cursor/mcp.json\` → \`{"mcpServers": {"operis": {"url": "${mcp}", "headers": {"Authorization": "Bearer \${env:OPERIS_API_KEY}"}}}}\`

**Only if you can't make HTTP requests** (a chat app with connectors, e.g. Claude.ai or ChatGPT): add \`${mcp}\` as a connector with no key and ask your user to sign in when the browser opens.

## 2. Hire someone: request_human

- \`title\`, \`instructions\` (everything the worker needs; you can't message them later; public areas only)
- \`location\`: \`{"address","lat","lng"}\`: the street address a worker can walk to (number and street, or an intersection) and that exact spot's coordinates, within 8 km of downtown (37.7749, -122.4194); vague addresses like "San Francisco, CA" are rejected. **Or** \`null\` with \`"remote": true\` for online work
- \`deadline\`: ISO 8601 UTC, ≥ 15 min away · \`budget_usd\`: all-in total, ≥ 3 (worker gets 75%)
- \`certification_required\`: null unless a license is needed
- \`proof\`: \`{"photos": {"min": N, "must_show": [...]}, "fields": [{"name","type":"string|number"}]}\` (online work: \`min: 0\` + fields). Optional \`"geofence_m"\`: leave it out for the default 300 m, where proof up to 1 km away goes to review instead of failing; a value you set is strict

**Read the result, status first:** \`rejected\` → see \`reason\`, don't resend · \`requested\` + \`escrow_url\` → your user pays that link once (card held, charged only if proof passes) (to skip links later: call \`setup_payment\` once and have your user save a card at its \`url\`; then jobs fund directly as \`held\`, or pass \`payment: {"payment_method": "pm_…"}\`) · \`held\` → funded, a person is being found. Always follow \`next_step\`.

**Follow it:** \`get_job {"job_id"}\` every 2–5 min (or pass \`callback_url\`); \`status_meaning\` explains each state. \`paid\` = done, \`proof_package\` has photo URLs, fields and the verifier score. \`cancel_job\` works until \`accepted\`.

## Never request
CAPTCHAs, verification/OTP codes, account sign-ups or logins, impersonation, handling cards/bank logins/IDs, following or photographing specific people, entering private property, licensed or dangerous work, signing anything. These are rejected automatically.
`;
}
