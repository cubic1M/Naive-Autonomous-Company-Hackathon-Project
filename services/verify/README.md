# services/verify — Cameron

Implemented in [`services/money-verification`](../money-verification/README.md) (`src/proof/*`, `src/certs/*`).

Verifier tools: `check_proof` (runs the automated review and returns the evidence), `approve_proof`, `escalate`, `get_proof_review`, `verify_notary`, `check_eligibility`. Shapes: `src/tools/schemas.ts`; contract-shaped adapters for `contracts/tools.ts` in `src/contract-tools.ts`.

- Checks in code: geofence (EXIF GPS, device GPS fallback), capture-time window, completeness, media reuse, vision confidence.
- `approve_proof` enforces the limits: a proof outside the geofence or with reused media can never be approved; confidence < 0.85 needs `override` by a human.
- Decision → `onProofDecision` → API moves the job and wakes Finance on approved.
