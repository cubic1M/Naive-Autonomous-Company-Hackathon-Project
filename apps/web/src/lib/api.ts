// Browser-side client for the Operis API. Everything goes through /api/* (rewritten to API_URL in
// next.config.ts) because the API sends no CORS headers. The worker token only ever appears in
// request paths; never log it or put it in a body, header or error message.

export interface ProofRequirement {
  photos?: { min: number; must_show: string[] };
  video?: { min_seconds: number };
  files?: { kinds: string[] };
  geofence_m: number;
  fields?: { name: string; type: "string" | "number" }[];
}

export interface WorkerJob {
  job: {
    title: string;
    instructions: string;
    location: { address: string; lat: number; lng: number };
    deadline: string | null;
    pay_usd: number;
    certification_required: string | null;
    proof_requirement: ProofRequirement | null;
    /** Proposed additions (docs/ACCOUNTS_API.md): who posted it and its category. */
    company?: string | null;
    category?: string | null;
  };
  /** Job status if you're the assigned worker; otherwise "open" or "unavailable". */
  state: string;
  can_accept: boolean;
  can_upload_proof: boolean;
  reply_code: string | null;
  /** Proposed (docs/ACCOUNTS_API.md): who is looking at the link. */
  viewer?:
    | { logged_in: true; name: string; cleared: boolean; identity_status: string }
    | { logged_in: false; phone_hint?: string | null };
  responded?: "declined" | null;
}

export interface Dashboard {
  active_job: DashJob | null;
  jobs: DashJob[];
  timeline: { job_id: string; event: string; naive_session_id: string | null; created_at: string }[];
  agent_feed: { type: string; agent_id?: string; session_id?: string; summary: string | null; created_at: string }[];
  money: { revenue: number; payouts: number; fees: number; refunds: number };
}

export interface DashJob {
  id: string;
  title: string;
  status: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  budget_usd: number | string;
  worker_id: string | null;
  updated_at: string;
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; data?: any };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with retries for flaky phone connections. Retries network errors and 502/503/504 only;
 * 4xx and 501 are real answers. Never throws: returns status 0 when the network never came back.
 */
export async function api<T>(path: string, init: RequestInit = {}, retries = 3): Promise<ApiResult<T>> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`/api${path}`, { cache: "no-store", ...init });
      const body = await res.json().catch(() => ({}));
      if ([502, 503, 504].includes(res.status) && attempt < retries) {
        await sleep(600 * 2 ** attempt);
        continue;
      }
      if (res.ok && body?.ok !== false) return { ok: true, status: res.status, data: body as T };
      return { ok: false, status: res.status, error: String(body?.error ?? `http_${res.status}`), data: body };
    } catch {
      if (attempt < retries) {
        await sleep(600 * 2 ** attempt);
        continue;
      }
      return { ok: false, status: 0, error: "network" };
    }
  }
}

const enc = encodeURIComponent;

export const getJob = (token: string) => api<WorkerJob>(`/v1/worker/jobs/${enc(token)}`);

export const postJson = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const acceptJob = (token: string) =>
  postJson<{ ok: true; state: "accepted" }>(`/v1/worker/jobs/${enc(token)}/accept`);

export interface DeclineFeedback {
  reasons: string[];
  more_like_this: boolean | null;
}

export const declineJob = (token: string, feedback?: DeclineFeedback) =>
  postJson<{ ok: true }>(`/v1/worker/jobs/${enc(token)}/decline`, feedback ?? {});

export interface ProofBody {
  media: { url: string; kind: string; name?: string; role?: string }[];
  gps_lat: number;
  gps_lng: number;
  captured_at: string;
  fields: Record<string, unknown>;
}

export const submitProof = (token: string, body: ProofBody) =>
  postJson<{ ok: true; proof_id: string; state: "proof_submitted" }>(`/v1/worker/jobs/${enc(token)}/proof`, body);

/** The API's payout-setup takes the token in the body (its contract, not ours). */
export const payoutSetup = (token: string) =>
  postJson<{ url: string | null; note?: string }>(`/v1/worker/payout-setup`, { token });

export const getDashboard = () => api<Dashboard>(`/v1/dashboard`, {}, 1);
