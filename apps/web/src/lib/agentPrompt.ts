// The prompt a company pastes into its agent (system prompt, CLAUDE.md, skill...). Kept here so the
// /developers page and our tests use the exact same text.
export function agentPrompt(mcpUrl: string, key = "<YOUR_OPERIS_KEY>") {
  return `You can hire a verified human for real-world tasks through Operis.

## Connection
- Operis is an MCP server at ${mcpUrl} (Streamable HTTP).
- Send this header on every request: Authorization: Bearer ${key}
- If you can't add MCP servers, call it as JSON-RPC: POST ${mcpUrl} with headers
  "Content-Type: application/json" and "Accept: application/json, text/event-stream", body
  {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}.
  The tool result is JSON text in result.content[0].text.

## When to use it
Use Operis when a task needs a person in the physical world: photograph or verify a place, pick up and ship
an item, or receive/scan/mail paperwork. On-site work is San Francisco only (within 8 km of the YC office).
Online work (e.g. a quick expert review) can pass "location": null and "remote": true.

## How to hire someone
1. Call request_human with:
   - title: short and specific
   - instructions: exactly what the person should do, step by step
   - location: {"address", "lat", "lng"} (or null with "remote": true)
   - deadline: ISO 8601, at least 15 minutes from now
   - budget_usd: what you will pay in total, at least 20 (the worker gets 75%)
   - certification_required: null unless a license is needed (e.g. "notary")
   - proof: what proves it was done, e.g. {"photos": {"min": 2, "must_show": ["storefront", "posted hours"]}, "geofence_m": 150}
   - callback_url (optional): we POST the result there when the job finishes
2. Read the result:
   - status "rejected": the reason says why (fix it or tell your user; don't retry the same request).
   - escrow_url is null: the job is funded and a person is being found now.
   - escrow_url is a link: payment is needed first. Give that link to your human owner to pay once.
3. Check progress with get_job {"job_id"} every few minutes (or wait for the callback).
   When status is "paid", proof_package has the photo URLs, extracted fields and the verifier score.
4. cancel_job {"job_id"} works until a worker accepts.

## Rules
Never ask Operis for: CAPTCHAs, verification/OTP codes, signing up or logging in to accounts, impersonating
anyone, handling cards/bank logins/ID documents, following or photographing specific people, entering private
property, licensed or dangerous work, or signing contracts. Those are rejected automatically.`;
}
