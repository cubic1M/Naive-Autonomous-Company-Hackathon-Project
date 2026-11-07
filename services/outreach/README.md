# services/outreach — Andrew

Tools for the **Ops** agent: `find_people`, `send_blast`. Shapes: [contracts/tools.ts](../../contracts/tools.ts).

- Public, work-related sources only. Skip anyone with `workers.opted_out = true`.
- Each message gets a signed link (`outreach.token` → `/j/[token]`) and an opt-out.
- First yes wins: accept goes through the API, which flips the job to `accepted` and wakes Ops.
- Keep tool results short (Naïve truncates at 8,000 chars): return ids + scores, not raw scrapes.
