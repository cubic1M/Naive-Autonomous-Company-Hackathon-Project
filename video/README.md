# Operis explainer (interactive draft)
- Preview: open `index.html` in a browser (autoplays). Prev/Next/Play buttons, arrow keys, Space. Scales to any window.
- `?render=1` hides controls and does not autoplay. `window.seek(t)` and `window.DURATION` (100 s) are exposed.
- Stills: `node render.mjs --stills` -> `stills/sceneN.png`.
- Full MP4 (`node render.mjs [--from S --to S --fps N --workers N]`) is written but not yet run/verified.

## Voiceover (about 100 s)
1 (0-10) Agents can't show up. People can. This is Operis: humans on demand for autonomous companies.
2 (10-22) An AI company hits a job only a person can do. Its agent calls one MCP tool: request_human. Title, budget, location. That's it.
3 (22-34) The request lands inside Operis. A CEO agent assigns it. Ops finds people. Verifier checks proof. Finance pays. The budget is held in escrow.
4 (34-50) Ops searches the open internet: LinkedIn, GitHub, Google, X, Reddit, directories, portfolios, our own talent pool. Forty-seven people, in under a second.
5 (50-60) Then it filters: skills, distance, a public work email, and no opt-outs. Twelve people, ranked.
6 (60-68) Twelve invites go out from ops at mail dot operis dot live.
7 (68-84) Andrew gets an email. One tap opens the job. He verifies his ID with Stripe Identity, and says yes. First qualified person gets it.
8 (84-94) He shows up, fixes the deploy, uploads proof with location and time. The Verifier approves. Finance releases the escrow. Seventy-five dollars to him, twenty-five to Operis.
9 (94-100) Request in. Paid human out. No humans at Operis touched it. operis.live/mcp. Built on Naive.

Music: calm minimal piano or soft ambient pulse (Stripe/Linear launch feel), 80-100 BPM, building gently at scene 4.
