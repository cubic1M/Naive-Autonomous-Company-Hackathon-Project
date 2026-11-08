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

**Easiest, if your app supports MCP sign-in (Claude.ai, ChatGPT, Claude Code, Cursor, VS Code):** add \`${mcp}\` as a connector / MCP server with no key and ask your user to sign in when the browser opens (Claude Code: \`claude mcp add --transport http operis ${mcp}\`, then the user runs \`/mcp\` → operis → Authenticate). Done. Use the HTTP path below if you need to act right away in this session or can't open a browser.

**Otherwise, set yourself up over HTTP:**
1. Ask your user for their **email** (and company name). They're the account owner and pay for jobs.
2. Create a key:
   \`POST ${origin}/v1/customers\` with JSON \`{"name": "<company>", "contact_email": "<email>", "description": "<what you do>"}\`
   → \`api_key\` (shown once). A 429 means too many sign-ups from this network: wait the \`Retry-After\` seconds and try once more, or use the MCP sign-in path above.
3. Save it as the environment variable \`OPERIS_API_KEY\` (a private shell profile like \`~/.zshrc\` is fine; never a repo or shared file), or give it to your user to keep.
4. Connect for future sessions if you can, reading the key from the variable:
   - Claude Code: \`claude mcp add --transport http --scope user operis ${mcp} --header 'Authorization: Bearer \${OPERIS_API_KEY}'\`
   - Cursor: \`~/.cursor/mcp.json\` → \`{"mcpServers": {"operis": {"url": "${mcp}", "headers": {"Authorization": "Bearer \${env:OPERIS_API_KEY}"}}}}\`
   - Anything else: use the HTTP calls below.
5. Until the MCP server loads (usually next session), call it over HTTP:
   \`POST ${mcp}\` · headers \`Authorization: Bearer <key>\`, \`Content-Type: application/json\`, \`Accept: application/json, text/event-stream\` ·
   body \`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}\` → JSON text in \`result.content[0].text\`.

## 2. Hire someone: request_human

- \`title\`, \`instructions\` (everything the worker needs; you can't message them later; public areas only)
- \`location\`: \`{"address","lat","lng"}\` within 8 km of 37.7749, -122.4194, **or** \`null\` with \`"remote": true\` for online work
- \`deadline\`: ISO 8601 UTC, ≥ 15 min away · \`budget_usd\`: all-in total, ≥ 20 (worker gets 75%)
- \`certification_required\`: null unless a license is needed
- \`proof\`: \`{"photos": {"min": N, "must_show": [...]}, "fields": [{"name","type":"string|number"}], "geofence_m": 150}\` (online work: \`min: 0\` + fields)

**Read the result, status first:** \`rejected\` → see \`reason\`, don't resend · \`requested\` + \`escrow_url\` → your user pays that link once (card held, charged only if proof passes) · \`held\` → funded, a person is being found. Always follow \`next_step\`.

**Follow it:** \`get_job {"job_id"}\` every 2–5 min (or pass \`callback_url\`); \`status_meaning\` explains each state. \`paid\` = done, \`proof_package\` has photo URLs, fields and the verifier score. \`cancel_job\` works until \`accepted\`.

## Never request
CAPTCHAs, verification/OTP codes, account sign-ups or logins, impersonation, handling cards/bank logins/IDs, following or photographing specific people, entering private property, licensed or dangerous work, signing anything. These are rejected automatically.
`;
}
