# apps/web — Dora

Worker website + live dashboard. Flow steps 7, 8, 10: [docs/FLOW.md](../../docs/FLOW.md#2-one-job-step-by-step).
Look and feel: the "Operis Homepage" design canvas (forest frame, paper cards, Inter / Inter Tight / JetBrains Mono).

Pages are 1:1 ports of the "Operis Homepage" design canvas (claude.ai artifact 2rzgXGi4P2Gx7NbWFWhmxL).

| Page | Purpose | Calls |
|---|---|---|
| `/` | Launch page | none |
| `/jobs` | Browse requests (search, categories, licensed filter, location, sort). Sample data for now | none |
| `/signup`, `/login` | Create account / log in: Google, text code, email link, password | `/v1/auth/*` |
| `/login?next=/j/<token>` | "Log in from a job": the job beside the login form; texts the number the link went to | `/v1/auth/code/*` with `job_token` |
| `/forgot-password`, `/reset-password` | Password reset by email | `/v1/auth/password/*` |
| `/onboarding?step=1..4` | Identity (Stripe Identity), skills + licenses, profiles + permissions, alerts + terms | `/v1/me*` |
| `/account` | The signed-in worker's settings | `/v1/me` |
| `/j/[token]` | Job: anyone can read it; Accept / Decline (with reasons) need a login | `GET /v1/worker/jobs/:token`, `POST …/accept`, `…/decline`, `…/feedback` |
| `/j/[token]/proof` | Photos/video/files with GPS + timestamp | `POST /v1/worker/jobs/:token/proof` (JSON) |
| `/j/[token]/payout` | Bank setup via Stripe Connect link | `POST /v1/worker/payout-setup` |
| `/j/[token]/upload` | Route handler: Vercel Blob client-upload tokens (only for the assigned worker) | `GET /v1/worker/jobs/:token` (server side) |
| `/dashboard` | Map, live job, agent feed, wake-ups, money (polls every 3 s) | `GET /v1/dashboard` |
| `/verification`, `/pricing`, `/payouts`, `/help`, `/about`, `/contact`, `/terms`, `/privacy` | Content pages (Terms/Privacy are marked drafts) | none |

**Worker accounts** are a proposal: the endpoints are specified in [docs/ACCOUNTS_API.md](docs/ACCOUNTS_API.md)
and implemented only in the mock API so far. The session is an httpOnly cookie set by the API through the
`/api/*` rewrite. Job-link tokens still only appear in URL paths (`/j/*` sends `Referrer-Policy: no-referrer`
and `Cache-Control: no-store`).

## Run it

```bash
npm install                        # from the repo root
cp apps/web/.env.example apps/web/.env.local
npm run dev -w @operis/web         # http://localhost:3000, proxies /api/* → API_URL (default :3001)

# no Postgres? use the in-memory stand-in for the API:
npm run mock-api -w @operis/web    # then open /j/demo, /j/taken (409), /j/nope (expired), /dashboard
                                   # demo login: demo@operis.live / operis-demo-1, or text code to (415) 555-0123
                                   # codes and login links show on the page (mock only); Google, LinkedIn and
                                   # Stripe Identity are simulated at /api/mock/*
```

## How it talks to the API

The API sends no CORS headers, so the browser calls `/api/...` on our own origin and `next.config.ts`
rewrites it to `${API_URL}/...`. Set `API_URL=https://api.operis.live` on the Vercel project.

## Proof uploads

- **GPS** is requested when the page opens (so a blocked permission shows up before photos are taken)
  and again at submit. Denied → explained and submit is blocked. Outside `geofence_m` → warned, not blocked.
- **captured_at** = the earliest attached file's `lastModified` (camera captures = shot time). Files older
  than 6 h get a warning, because the Verifier flags them.
- **Original files only**: never drawn to a canvas or re-encoded, so EXIF survives.
- **Storage**: with `BLOB_READ_WRITE_TOKEN` set on this project, the phone uploads straight to Vercel Blob
  (no 4.5 MB function limit, multipart for big videos, retries) and we send the API JSON with the blob
  URLs. Without it we fall back to `data:` URLs inside the JSON, capped at 3 MB total — fine for testing,
  too small for real phone photos.
- Each media item is `{url, kind, name, role}` where role is `photo | video | file | certification`.
  `fields` also carries `must_show_checked`, `gps_accuracy_m`, `gps_fixed_at`, `submitted_at`.
