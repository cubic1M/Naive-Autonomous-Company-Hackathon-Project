import { normEmail } from '../geo.js';
import { arr, callMonid, domainOf, num, rec, str, type Enricher } from './types.js';

export const HUNTER_ID = 'monid:hunterio/domain-search';

const ROLE_PREFIXES = ['info', 'jobs', 'booking', 'bookings', 'hello', 'contact', 'hire', 'careers', 'staffing', 'events', 'team', 'office'];

/** Domains that are not the business's own site (their emails are useless). */
export const SKIP_DOMAINS = /(^|\.)(facebook|instagram|yelp|linkedin|twitter|google|linktr|squarespace|wixsite|business)\./;

/** Pick the best published email from a hunter /domain-search output, skipping guessed ones. */
export function pickHunterEmail(output: unknown): string | null {
  let best: { email: string; score: number } | null = null;
  for (const raw of arr(rec(rec(output)?.data)?.emails)) {
    const r = rec(raw);
    if (!r) continue;
    if (r.source_type === 'generated' || r.provenance === 'inferred') continue;
    if (rec(r.verification)?.status === 'invalid') continue;
    const email = normEmail(str(r.value));
    if (!email) continue;
    const local = email.split('@')[0] ?? '';
    let score = (num(r.confidence) ?? 0) / 100;
    if (ROLE_PREFIXES.includes(local)) score += 3;
    if (r.type === 'generic') score += 2;
    if (arr(r.sources).length > 0) score += 1;
    if (!best || score > best.score) best = { email, score };
  }
  return best?.email ?? null;
}

export const hunter: Enricher = {
  id: HUNTER_ID,
  costEstimateUsd: 0.0245,
  async enrich(lead, monid) {
    const domain = domainOf(lead.website);
    if (!domain || SKIP_DOMAINS.test(domain)) return { email: null, phone: null, cost_usd: 0 };
    const r = await callMonid(monid, 'hunterio', '/domain-search', { body: { domain, limit: 5 } });
    return { email: pickHunterEmail(r.output), phone: null, cost_usd: r.cost_usd };
  },
};
