import { profileFromUrl } from '../../profiles.js';
import type { Lead } from '../../types.js';
import { arr, callMonid, rec, str, type SourceAdapter, type SourceContext } from '../types.js';
import { cityFromAddress } from './googleProfiles.js';
import { personLead } from './common.js';

export const LINKEDIN_PEOPLE_ID = 'monid:ploid/linkedin/search';
const LIMIT = 8;

export function buildLinkedinFilters(ctx: Pick<SourceContext, 'job' | 'hints' | 'remote'>): Record<string, unknown> {
  const roles = ctx.hints.roles;
  const keywords = (roles.length ? roles.slice(0, 2) : ctx.hints.skills.length ? ctx.hints.skills.slice(0, 3) : [ctx.job.title]).join(' ');
  const filters: Record<string, unknown> = { keywords };
  if (roles[0]) filters.title = roles[0];
  const city = ctx.remote ? null : cityFromAddress(ctx.job.address);
  if (city) filters.location = city;
  return filters;
}

export function parseLinkedinPeople(output: unknown): Lead[] {
  const leads: Lead[] = [];
  for (const raw of arr(rec(rec(output)?.data)?.items)) {
    const r = rec(raw);
    const profile = profileFromUrl(str(r?.profileUrl));
    if (!r || !profile) continue;
    leads.push(
      personLead({
        name: str(r.fullName),
        source: LINKEDIN_PEOPLE_ID,
        source_ref: str(r.publicIdentifier) ?? profile.handle ?? null,
        profiles: [profile],
        headline: str(r.headline),
        snippet: str(r.headline),
        location_text: str(r.location),
      }),
    );
  }
  return leads;
}

export const linkedinPeople: SourceAdapter = {
  id: LINKEDIN_PEOPLE_ID,
  costEstimateUsd: 0.01 * LIMIT,
  perQuery: false,
  async run(ctx) {
    const r = await callMonid(ctx.monid, 'ploid', '/linkedin/search', {
      body: { filters: buildLinkedinFilters(ctx), limit: LIMIT },
    });
    return { leads: parseLinkedinPeople(r.output).slice(0, LIMIT), cost_usd: r.cost_usd };
  },
};
