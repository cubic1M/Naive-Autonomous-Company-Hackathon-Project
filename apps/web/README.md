# apps/web — Dora

Worker website + live dashboard. Flow steps 7, 8, 10: [docs/FLOW.md](../../docs/FLOW.md#2-one-job-step-by-step).

| Page | Purpose | Calls |
|---|---|---|
| `/j/[token]` | Job: description, pay, location, certification; Yes / No | `GET /v1/worker/jobs/:token`, `POST .../accept`, `POST .../decline` |
| `/j/[token]/proof` | Upload photos/video/files with GPS + timestamp | `POST /v1/worker/jobs/:token/proof` |
| `/payout` | Bank setup via Stripe Connect link | `POST /v1/worker/payout-setup` |
| `/dashboard` | Map, live job, agent feed, money | `GET /v1/dashboard` |

No login: the signed token in the link is the worker's access.
