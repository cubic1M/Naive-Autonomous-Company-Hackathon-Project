import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, type Env } from '../../src/env.js';
import type { Monid, MonidInput, MonidRunResult } from '../../src/monid.js';
import type { JobForOutreach } from '../../src/types.js';

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url)), 'utf8'));
}

const FIXTURES: Record<string, { file: string; cost: number }> = {
  'litescrape/google/maps': { file: 'litescrape__google_maps', cost: 0.00015 },
  'anyapi/maps.search_nearby': { file: 'anyapi__maps.search_nearby', cost: 0.0013 },
  'hunterio/domain-search': { file: 'hunterio__domain-search', cost: 0.0245 },
  'search1api/crawl': { file: 'search1api__crawl', cost: 0.001 },
  'ploid/linkedin/search': { file: 'ploid__linkedin_search', cost: 0.01 },
};

export type Override = ((input: MonidInput) => unknown) | { error: string } | { output: unknown; cost?: number };

/** Serves the real fixtures by provider+endpoint; records calls; per-endpoint overrides. */
export class FakeMonid implements Monid {
  readonly calls: { provider: string; endpoint: string; input: MonidInput }[] = [];
  private overrides = new Map<string, Override>();

  /** key like "hunterio/domain-search" */
  override(key: string, o: Override): this {
    this.overrides.set(key, o);
    return this;
  }

  callsTo(key: string): number {
    return this.calls.filter((c) => `${c.provider}${c.endpoint}` === key).length;
  }

  async run(provider: string, endpoint: string, input: MonidInput): Promise<MonidRunResult> {
    this.calls.push({ provider, endpoint, input });
    const key = `${provider}${endpoint}`;
    const o = this.overrides.get(key);
    const fx = FIXTURES[key];
    const cost = fx?.cost ?? 0;
    const done = (output: unknown, c = cost): MonidRunResult => ({ runId: 'r', status: 'COMPLETED', httpStatus: 200, output, cost_usd: c });
    if (o) {
      if (typeof o === 'function') return done(o(input));
      if ('error' in o) return { runId: 'r', status: 'FAILED', httpStatus: 500, output: o.error, cost_usd: 0 };
      return done(o.output, o.cost ?? cost);
    }
    if (!fx) return { runId: 'r', status: 'FAILED', httpStatus: 404, output: null, cost_usd: 0 };
    return done(fixture(fx.file));
  }
}

export function makeEnv(over: Partial<Env> = {}): Env {
  return {
    MONID_API_KEY: 'test',
    MONID_BASE_URL: DEFAULTS.MONID_BASE_URL,
    PUBLIC_BASE_URL: 'http://localhost',
    LINK_SIGNING_SECRET: 'secret',
    NAIVE_BASE_URL: DEFAULTS.NAIVE_BASE_URL,
    OUTREACH_MAX_SPEND_USD: 0.25,
    OUTREACH_RADIUS_KM: 8,
    OUTREACH_LIVE: false,
    OUTREACH_TEST_ALLOWLIST: [],
    PAUSE_OUTREACH: false,
    OUTREACH_MANUAL_DAILY_CAP: 20,
    OUTREACH_MANUAL_QUEUE: true,
    ...over,
  };
}

export function makeJob(over: Partial<JobForOutreach> = {}): JobForOutreach {
  return {
    id: 'job1',
    title: 'Hold a sign near the YC office',
    instructions: 'Stand outside holding a sign.',
    address: 'SF',
    lat: 37.7749,
    lng: -122.4194,
    deadline: null,
    budget_usd: 60,
    worker_pay_usd: null,
    certification_required: null,
    remote: false,
    status: 'requested',
    ...over,
  };
}

/** SourceContext for adapter tests. */
export function makeCtx(over: Partial<import('../../src/sources/types.js').SourceContext> & { monid: import('../../src/monid.js').Monid }) {
  return {
    job: makeJob(),
    radiusKm: 8,
    queries: [] as string[],
    hints: { roles: [] as string[], skills: [] as string[], credential: null as string | null },
    remote: false,
    ...over,
  };
}
