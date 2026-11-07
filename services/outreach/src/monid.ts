/**
 * Minimal Monid HTTP client (same API the `monid` CLI uses).
 *   POST {base}/v1/run   { provider, endpoint, input: { body?, queryParams?, pathParams? } }
 *   GET  {base}/v1/runs/{runId}
 * Auth: Authorization: Bearer <MONID_API_KEY>.
 * Runs may finish synchronously or return a non-terminal status; we poll until terminal or timeout.
 */

export interface MonidInput {
  body?: Record<string, unknown>;
  queryParams?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
}

export type MonidStatus =
  | 'READY'
  | 'RUNNING'
  | 'STOPPING'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'STOPPED'
  | 'TIMED_OUT';

export const TERMINAL: ReadonlySet<MonidStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'BLOCKED',
  'STOPPED',
  'TIMED_OUT',
]);

export interface MonidRunResult {
  runId: string;
  status: MonidStatus;
  /** Provider HTTP status; 2xx means `output` holds results. */
  httpStatus: number | null;
  /** The provider's response body (shape depends on the endpoint). */
  output: unknown;
  cost_usd: number;
}

/** Everything in this package depends on this interface, so tests inject a fake. */
export interface Monid {
  run(provider: string, endpoint: string, input: MonidInput, opts?: { timeoutMs?: number }): Promise<MonidRunResult>;
}

export class MonidError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = 'MonidError';
  }
}

interface RawRun {
  runId?: string;
  status?: MonidStatus;
  providerResponse?: { httpStatus?: number };
  output?: unknown;
  cost?: { value?: number };
}

function toResult(raw: RawRun): MonidRunResult {
  return {
    runId: raw.runId ?? '',
    status: raw.status ?? 'FAILED',
    httpStatus: raw.providerResponse?.httpStatus ?? null,
    output: raw.output ?? null,
    cost_usd: raw.cost?.value ?? 0,
  };
}

export class HttpMonid implements Monid {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.monid.ai',
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly pollMs = 2000,
  ) {}

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<RawRun> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new MonidError('INVALID_RESPONSE', `non-JSON response from Monid (${res.status})`, res.status);
    }
    // A failed provider call still comes back as a run body; treat that as a result, not an exception.
    if (!res.ok) {
      const run = data as RawRun | null;
      if (run && typeof run === 'object' && 'runId' in run && 'status' in run) return run;
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new MonidError(err?.code ?? `HTTP_${res.status}`, err?.message ?? `Monid HTTP ${res.status}`, res.status);
    }
    return data as RawRun;
  }

  async run(provider: string, endpoint: string, input: MonidInput, opts: { timeoutMs?: number } = {}): Promise<MonidRunResult> {
    const cleaned: MonidInput = {};
    if (input.body && Object.keys(input.body).length) cleaned.body = input.body;
    if (input.queryParams && Object.keys(input.queryParams).length) cleaned.queryParams = input.queryParams;
    if (input.pathParams && Object.keys(input.pathParams).length) cleaned.pathParams = input.pathParams;

    let raw = await this.request('POST', '/v1/run', { provider, endpoint, input: cleaned });
    const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
    while (raw.status && !TERMINAL.has(raw.status) && raw.runId) {
      if (Date.now() > deadline) {
        return { ...toResult(raw), status: 'TIMED_OUT' };
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
      raw = await this.request('GET', `/v1/runs/${encodeURIComponent(raw.runId)}`);
    }
    return toResult(raw);
  }
}

/** True when the run finished and the provider answered 2xx. */
export function succeeded(r: MonidRunResult): boolean {
  return r.status === 'COMPLETED' && (r.httpStatus === null || (r.httpStatus >= 200 && r.httpStatus < 300));
}
