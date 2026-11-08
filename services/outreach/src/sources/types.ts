import type { Monid, MonidRunResult } from '../monid.js';
import { succeeded } from '../monid.js';
import type { JobForOutreach, Lead, Profile, SearchHints } from '../types.js';

export interface SourceContext {
  job: JobForOutreach;
  monid: Monid;
  radiusKm: number;
  queries: string[];
  /** Merged agent hints + heuristics (always present; fields may be empty). */
  hints: Required<Pick<SearchHints, 'roles' | 'skills'>> & { credential: string | null };
  /** true = online work anywhere; false = on-site near job.lat/lng. */
  remote: boolean;
}

export interface SourceAdapter {
  id: string;
  /** Worst-case USD for one provider call. */
  costEstimateUsd: number;
  /** True when run() makes one call per query (cost scales with queries.length). */
  perQuery: boolean;
  /** Throws SourceError when every call failed. */
  run(ctx: SourceContext): Promise<{ leads: Lead[]; cost_usd: number }>;
}

/** Enrichment: look up a contact for an existing lead. Not a search. */
export interface Enricher {
  id: string;
  costEstimateUsd: number;
  /** Optional cheap pre-check: skip leads this enricher can't help (e.g. no LinkedIn URL). Default: always applies. */
  applies?(lead: Lead): boolean;
  enrich(
    lead: Lead,
    monid: Monid,
  ): Promise<{ email: string | null; phone: string | null; cost_usd: number; profiles?: Profile[] }>;
}

/** A failed source call that may still have cost money. */
export class SourceError extends Error {
  constructor(
    message: string,
    public readonly cost_usd = 0,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

// ---------- tolerant JSON helpers for provider output ----------

export type Rec = Record<string, unknown>;

export function rec(v: unknown): Rec | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null;
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function str(v: unknown): string | null {
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Drop tracking query strings / fragments from a website URL. */
export function cleanUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return `${u.origin}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return null;
  }
}

export function domainOf(website: string | null): string | null {
  if (!website) return null;
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Run a provider call and return its output, or throw SourceError carrying the cost. */
export async function callMonid(
  monid: Monid,
  provider: string,
  endpoint: string,
  input: Parameters<Monid['run']>[2],
): Promise<MonidRunResult> {
  let r: MonidRunResult;
  try {
    r = await monid.run(provider, endpoint, input);
  } catch (e) {
    throw new SourceError(`${provider}${endpoint}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!succeeded(r)) {
    throw new SourceError(`${provider}${endpoint}: run ${r.status} (http ${r.httpStatus ?? 'n/a'})`, r.cost_usd);
  }
  return r;
}

/** Run one call per query; tolerate partial failure, throw only if all failed. */
/** Parallel provider calls per source (Monid handles bursts; each call is still budget-reserved up front). */
export const PER_QUERY_CONCURRENCY = 6;

export async function perQueryRun(
  ctx: SourceContext,
  call: (q: string) => Promise<{ leads: Lead[]; cost_usd: number }>,
): Promise<{ leads: Lead[]; cost_usd: number }> {
  const leads: Lead[] = [];
  let cost = 0;
  let ok = 0;
  let lastErr: SourceError | null = null;
  // Queries run in parallel (up to PER_QUERY_CONCURRENCY at a time): a source with ~14 queries at ~6 s each
  // would otherwise take ~80 s and miss find_people's search window.
  let next = 0;
  const worker = async () => {
    while (next < ctx.queries.length) {
      const q = ctx.queries[next++]!;
      try {
        const r = await call(q);
        leads.push(...r.leads);
        cost += r.cost_usd;
        ok++;
      } catch (e) {
        lastErr = e instanceof SourceError ? e : new SourceError(e instanceof Error ? e.message : String(e));
        cost += lastErr.cost_usd;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PER_QUERY_CONCURRENCY, ctx.queries.length) }, worker));
  const failed = lastErr as SourceError | null;
  if (ok === 0 && failed) throw new SourceError(failed.message, cost);
  return { leads, cost_usd: cost };
}
