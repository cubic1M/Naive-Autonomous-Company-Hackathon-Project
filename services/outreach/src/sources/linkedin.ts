import type { Lead } from '../types.js';
import { arr, callMonid, rec, str, SourceError, type SourceAdapter } from './types.js';

export const LINKEDIN_ID = 'monid:ploid/linkedin/search';
const LIMIT = 5;

export function parseLinkedin(output: unknown): Lead[] {
  const leads: Lead[] = [];
  for (const raw of arr(rec(rec(output)?.data)?.items)) {
    const r = rec(raw);
    if (!r) continue;
    const profile = str(r.profileUrl);
    if (!profile) continue;
    leads.push({
      name: str(r.fullName),
      kind: 'person',
      email: null,
      phone: null,
      website: null,
      profile_url: profile,
      address: str(r.location),
      lat: null,
      lng: null,
      source: LINKEDIN_ID,
      source_ref: str(r.publicIdentifier) ?? str(r.socialId),
      categories: [],
      rating: null,
      snippet: (str(r.headline) ?? '').slice(0, 300) || null,
    });
  }
  return leads;
}

/** Only runs when job.certification_required is set. Always passes limit (billed per result). */
export const linkedin: SourceAdapter = {
  id: LINKEDIN_ID,
  costEstimateUsd: 0.01 * LIMIT,
  perQuery: false,
  async run(ctx) {
    const cert = ctx.job.certification_required;
    if (!cert) throw new SourceError('linkedin: no certification_required');
    const r = await callMonid(ctx.monid, 'ploid', '/linkedin/search', {
      body: { filters: { keywords: cert, location: 'San Francisco' }, limit: LIMIT },
    });
    return { leads: parseLinkedin(r.output).slice(0, LIMIT), cost_usd: r.cost_usd };
  },
};
