# Operis test plan

Run top to bottom before the demo. Each test says **how**, **expected**, and **who**. Tick the box when it passes.
Production: website `https://operis.live`, API `https://api.operis.live`. Secrets live in `apps/api/.env.local` (never in chat).

**Setup for checking:** `export ADMIN_KEY=…` (from `.env.local`). Keep open: the backoffice
(`https://admin.operis.live`, founder email + password), the founder console (`https://api.operis.live/admin?key=$ADMIN_KEY`), and Stripe test mode.
To run the smoke test against production you need the production `DATABASE_URL`:
`npx vercel env pull /tmp/prod.env --environment production --yes`.

---

## 1. Automated checks (5 min) · Edwin

- [ ] **API type check and build:** `cd apps/api && npx tsc --noEmit && npm run build` → no errors.
- [ ] **Web build:** `cd apps/web && npx tsc --noEmit && npx next build` → no errors; routes include `/developers`, `/backoffice`.
- [ ] **Money/verification suite:** `cd services/money-verification && ../../node_modules/.bin/vitest run` → 261/261 pass.
- [ ] **Outreach suite:** `cd services/outreach && npx vitest run` → all pass.
- [ ] **Local smoke** (mocks): `npm run dev` then `npm run smoke` → **20/20**.
- [ ] **Production smoke** (real payments mode): `DATABASE_URL=$(grep ^DATABASE_URL= /tmp/prod.env | cut -d= -f2- | tr -d '"') API=https://api.operis.live npm run smoke` → **8/8** (Stripe checkout link, cancel unpaid, guardrails).
- [ ] **Health:** `curl https://api.operis.live/api/health` → `"ok": true`, every tool `"real"`.

## 2. Agent company onboarding (5 min) · anyone

- [ ] Open `https://operis.live` → **Get API access** → lands on `/developers`.
- [ ] Create a key (company name + email) → the key shows once; copy it.
- [ ] **Test my key** → "Connected · request_human, get_job, cancel_job".
- [ ] The **Prompt for your agent** tab shows the prompt with your key and `https://operis.live/mcp` filled in; the Claude Code, Cursor, Naïve and curl tabs do too.
- [ ] The **backoffice** lists the new company under Companies.

## 3. The agent prompt works blind (10 min) · Edwin

- [ ] Give a fresh agent (Claude Code in an empty folder) **only** the copied prompt, and ask: "Hire someone to photograph the storefront at 2102 Union St, SF (37.797, -122.433), 2 photos, $30, 3 hours."
  → it calls `request_human` once and gets `status` `requested` + `escrow_url` (real payments), with a `next_step` telling it to have the owner pay.
- [ ] Ask it for a remote job (no location) → accepted with `remote: true`; no geofence needed.
- [ ] Ask it for something banned ("receive an SMS code for me") → `rejected` with a reason; the agent doesn't retry.
- [ ] Ask for a job in Oakland → `rejected` (outside the service area).

## 4. Full paid job, start to finish (30–45 min) · Edwin + a worker (Andrew is allowlisted)

- [ ] **Customer:** `request_human` (via the curl tab on `/developers`, or an agent) for a spot within 8 km of 37.7749, -122.4194, budget $30 → `escrow_url`.
- [ ] **Pay:** open `escrow_url`, card `4242 4242 4242 4242`, any future date, any CVC → Stripe shows an **uncaptured** PaymentIntent; the backoffice shows the request move to **Funded**.
- [ ] **CEO:** within a minute the backoffice "Agent activity" shows the CEO reading the job and creating a board card. Approve when asked (console → Agent approvals → **Approve for this session**, or `npm run approvals -- allow-all --session`).
- [ ] **Ops:** `find_people` → approve; `send_blast` → approve. The request moves to **Finding people**. In demo mode only `OUTREACH_TEST_ALLOWLIST` (azli@stanford.edu) gets a real email from `ops@mail.operis.live`; the others are recorded as dry runs.
- [ ] **Worker:** the email link opens `https://operis.live/j/<token>` (Dora's page) → **Accept** → request moves to **Worker on it**.
- [ ] **Proof:** at the location, on a phone: allow location, take the photos, submit → the photos upload to Blob (full size); request moves to **Proof in**.
- [ ] **Verifier:** checks the proof (tier 0 for under $50: ≥1 photo, confidence ≥ 0.80, inside 150 m) → approve when asked → **Approved**. If it escalates, the console's **Needs your review** shows it: Approve → pay.
- [ ] **Finance:** `capture_payment`, then `payout` → approve when asked → **Paid**. Stripe shows the PaymentIntent **captured**. The worker gets a payout-setup link (Stripe Connect) if they haven't done it yet.
- [ ] **Customer result:** `get_job` → `status: paid`, `status_meaning` says done, `proof_package.media_urls` load.
- [ ] **Money:** backoffice numbers and `operis.ledger` match Stripe (payout = 75%, fee = 25%).

## 5. Failure paths (20 min) · Edwin

- [ ] **Cancel before accept:** `request_human` → `cancel_job` → `cancelled`; if it was paid, the Stripe hold is released.
- [ ] **No taker:** fund a job and don't accept → after 15 min the agent activity shows Ops woken ("no taker") and widening the search.
- [ ] **Deadline passes:** set a short deadline, don't deliver → within 5 min of the deadline the job is **Expired** then **Refunded** (sweep cron).
- [ ] **Bad proof:** upload a photo taken far from the location → the Verifier escalates; console → **Reject** → the customer is refunded.
- [ ] **Partial refund:** ask Finance (or call `operis.refund` with `amount_cents`) on a paid job → Stripe shows a partial refund; the ledger has one refund line.
- [ ] **Over the $150 cap:** a payout above $150 returns `over_limit`, and Finance hands it to the CEO, who runs `release_payout_large`.
- [ ] **Chargeback:** in Stripe test mode, dispute a captured payment → the Disputes agent wakes on that job (agent activity) and drafts evidence.

## 6. Security and isolation (5 min) · Edwin

- [ ] `curl -X POST https://operis.live/mcp` (no key) → **401** with get-a-key instructions.
- [ ] `curl -X POST https://api.operis.live/mcp/internal` (no key) → **401**.
- [ ] `curl https://api.operis.live/v1/dashboard` and `/v1/admin/requests` (no key) → **401**.
- [ ] Customer A's key on `get_job` for customer B's job → "job not found".
- [ ] Six `POST /v1/customers` from one IP within an hour → the 6th is **429**.
- [ ] A tampered job link (`/j/<token>` with a changed character) → "invalid or expired".

## 7. Email and DNS (5 min) · Edwin / Andrew

- [ ] Send an email to `ops@operis.live` from an outside address → it arrives in Outlook.
- [ ] Andrew's outreach email arrives from `ops@mail.operis.live` and isn't in spam.
- [ ] `dig +short MX operis.live` → `operis-live.mail.protection.outlook.com`; `dig +short MX mail.operis.live` → `inbound-smtp.us-east-1.amazonaws.com`.

## 8. Demo readiness (15 min before) · everyone

- [ ] Production smoke 8/8; health all real.
- [ ] Monid wallet has credit (https://app.monid.ai/wallet).
- [ ] No pending approvals left over: `npm run approvals` → "No pending approvals".
- [ ] Backoffice and founder console open and signed in on the demo laptop; Andrew's phone charged and on the allowlist.
- [ ] Decide `AUTO_APPROVE_TOOLS` for the demo (fewer approval clicks) and set it on operis-api if wanted.
- [ ] Kill switches known: `PAUSE_OUTREACH=true`, `MOCK_TOOLS=<tool>`.
