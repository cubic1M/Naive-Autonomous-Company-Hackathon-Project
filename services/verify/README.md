# services/verify — Cameron

Tools for the **Verifier** agent: `check_proof`, `approve_proof`, `escalate`. Shapes: [contracts/tools.ts](../../contracts/tools.ts).

- `check_proof` returns **evidence** (GPS distance, timestamp, checklist + confidence). The agent decides.
- `approve_proof` **enforces** the limits in code: score ≥ 0.85 and within `geofence_m`, else returns an error.
- Approve → API moves job to `approved` and wakes Finance.
