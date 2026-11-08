# Worker accounts: API request for Edwin

**Status:** proposal from Dora (apps/web), 2026-11-07. The web app already uses these endpoints against
`apps/web/scripts/mock-api.mjs`; nothing in `apps/api` or `contracts/` has changed. This changes the shared
flow (workers now have accounts), so it needs a team OK, especially from Andrew, whose outreach links
keep working but now meet a login wall before Accept.

## What changes for the product

- Workers can **create an account** (name, email, phone, password) or sign in with **Google**, a
  **6-digit SMS code**, or an **emailed login link**.
- Onboarding collects **ID verification (Stripe Identity)**, skills, licenses (registry check),
  profiles/permissions and alert preferences.
- Job links `/j/<token>` stay public to **read**, but **accept / decline need a session**.
  (Outreach still sends the same links; SMS `YES 1234` replies can keep working as they do today.)

## Sessions

- `POST` auth endpoints set an **httpOnly, SameSite=Lax** cookie `operis_session` (30 days, or a session
  cookie when `remember: false`). The browser reaches the API through the web app's `/api/*` rewrite, so
  the cookie is first-party on `operis.live`. No tokens in JS, no CORS needed.
- Any endpoint below that needs a user returns `401 { error: "login_required" }` without one.
- Suggested tables: `worker_accounts` (or columns on `workers`: `password_hash`, `google_sub`,
  `email_verified_at`, `phone_verified_at`, `identity_status`, `stripe_verification_session`,
  `onboarding jsonb`, `agreed_terms_at`), `worker_sessions (id, worker_id, expires_at)`,
  `auth_codes (phone, code_hash, expires_at, tries)`, `auth_links (token_hash, kind, worker_id, expires_at, next)`,
  `worker_licenses (id, worker_id, type, state, number, certificate_url, status, checked_at)`.
- Link the account to the existing `workers` row by phone/email, so people found by outreach who sign up
  later keep their history.

## Auth endpoints

| Method + path | Body / query | Success | Errors |
|---|---|---|---|
| `POST /v1/auth/signup` | `{name, email, phone, password}` (password ≥ 10) | sets cookie · `{ok, user}` | 400 `invalid_fields` / `weak_password`, 409 `email_taken` / `phone_taken` |
| `POST /v1/auth/login` | `{email, password, remember?}` | sets cookie · `{ok, user}` | 401 `bad_credentials` |
| `POST /v1/auth/code/send` | `{phone}` **or** `{job_token}` (texts the number that link was sent to) | `{ok, phone_hint: "(•••) •••-0123"}` | 400 `invalid_phone`, 404 `no_account`, 429 rate limit |
| `POST /v1/auth/code/verify` | `{phone, code}` **or** `{job_token, code}` | sets cookie · `{ok, user}` | 400 `wrong_code` / `code_expired`, 429 `too_many_tries` (5) |
| `POST /v1/auth/link/send` | `{email, next}` | `{ok}` (emails `https://operis.live/api/v1/auth/link/verify?t=…`, 15 min) | 404 `no_account` |
| `GET /v1/auth/link/verify?t=` | | sets cookie · **302** to the stored `next` (same-site path only) | 302 `/login?error=link_expired` |
| `POST /v1/auth/password/reset` | `{email}` | always `{ok}` (no account probing); emails `https://operis.live/reset-password?t=…` (30 min) | |
| `POST /v1/auth/password/reset/confirm` | `{t, password}` | sets cookie · `{ok, user}` | 400 `link_expired` / `weak_password` |
| `GET /v1/auth/google/start?next=` | | **302** to Google OAuth (`redirect_uri = https://operis.live/api/v1/auth/google/callback`) | |
| `GET /v1/auth/google/callback?code&state` | | sets cookie · **302** to `next`, or `/onboarding?next=…` for a new account | |
| `POST /v1/auth/logout` | | clears cookie · `{ok}` | |

Codes, links and resets go out through `sendSms()` (Mobilerun) and the ops@operis.live inbox. The mock
also returns `dev_code` / `dev_link` so the UI can show them; **the real API must not**.

## The signed-in worker

`GET /v1/me` → `{ user }` where `user` is:

```ts
{
  id, name, email, phone, has_password,
  identity: { status: "unverified" | "processing" | "verified" | "requires_input", id_type },
  skills: string[],                       // from the design's 9 categories
  licenses: { id, type, state, number, certificate, status: "active" | "not_found" | "pending", checked_at, expires? }[],
  profiles: { linkedin: { name, headline } | null, portfolio_url, other_url },
  permissions: { read_profiles, search_public, learn_choices },   // all default false
  alerts: { sms, email, call }, min_pay, radius, quiet_hours,
  agreed_terms_at, onboarding_step, onboarding_done,
}
```

| Method + path | Body | Notes |
|---|---|---|
| `PATCH /v1/me` | any of `name, skills, profiles, permissions, alerts, min_pay, radius, quiet_hours, onboarding_step, onboarding_done`, plus `agreed_terms: true` | returns `{ok, user}`; server sets `agreed_terms_at` |
| `POST /v1/me/identity/session` | `{id_type, return_url}` | **Stripe Identity:** `verificationSessions.create({ type: "document", options: { document: { require_matching_selfie: true } }, return_url: "https://operis.live" + return_url, metadata: { worker_id } })` → `{ok, url}` (the hosted page). Set status `processing` when the worker comes back; the webhook `identity.verification_session.verified` / `.requires_input` sets the final status. Cameron's Stripe account. |
| `POST /v1/me/licenses` | `{type, state, number, certificate}` | checks the state registry (CA SOS for notaries, State Bar, CBA for CPAs…) → `{ok, license, user}`; `pending` if the check is async |
| `DELETE /v1/me/licenses/:id` | | `{ok, user}` |
| `GET /v1/me/linkedin/start?return=` | | 302 to LinkedIn OAuth (OpenID: name, headline) |
| `GET /v1/me/linkedin/callback` | | stores the profile, 302 to `return` |
| `DELETE /v1/me/linkedin` | | `{ok, user}` |

The ID images never touch our servers; agent companies only ever see "verified".

## Changes to the existing worker routes

- `GET /v1/worker/jobs/:token` adds
  - `job.company` (customer name) and `job.category`,
  - `viewer`: `{ logged_in: true, name, cleared, identity_status }` or `{ logged_in: false, phone_hint }`
    (`phone_hint` = masked number the link was texted to, for "Text a code to (•••) •••-0123").
- `POST /v1/worker/jobs/:token/accept` and `/decline` now **require a session** → `401 login_required`.
  Optional: `403 not_verified` when `identity.status !== "verified"` (the UI already handles it). On accept,
  bind the outreach worker to the account (or reject if the token belongs to someone else, your call).
- `POST /v1/worker/jobs/:token/decline` takes an optional body `{ reasons: string[], more_like_this: boolean | null }`.
- New `POST /v1/worker/jobs/:token/feedback` `{ more_like_this: boolean }` (after accepting).
- `proof` and `payout-setup` are unchanged (still keyed by the link token).

## Not covered yet

- A public "open requests" list for `/jobs` (it shows the design's sample data).
- Editing name/email/phone after signup (needs re-verification).
