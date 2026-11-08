import { profileFromUrl } from '../../profiles.js';
import type { Lead, Profile } from '../../types.js';
import { arr, callMonid, rec, str, type SourceAdapter, type SourceContext } from '../types.js';
import { addProfile, personLead } from './common.js';
import { cityFromAddress } from './googleProfiles.js';

export const PEOPLE_SEARCH_ID = 'monid:context.dev/people/search';

export function buildPeopleQuery(ctx: Pick<SourceContext, 'job' | 'hints' | 'remote'>): string {
  const roles = ctx.hints.roles.length ? ctx.hints.roles.slice(0, 2) : [ctx.job.title];
  let q = `freelance ${roles.join(' or ')}`;
  if (ctx.hints.skills.length) q += ` experienced in ${ctx.hints.skills.slice(0, 3).join(', ')}`;
  const city = ctx.remote ? null : cityFromAddress(ctx.job.address);
  if (city) q += ` in ${city}`;
  return q.slice(0, 500);
}

export function parsePeopleSearch(output: unknown): Lead[] {
  const leads: Lead[] = [];
  for (const raw of arr(rec(output)?.results)) {
    const r = rec(raw);
    if (!r) continue;
    const profiles: Profile[] = [];
    for (const u of arr(r.profiles)) addProfile(profiles, profileFromUrl(str(u)));
    if (!profiles.length) continue;
    const role = rec(r.role);
    const company = str(rec(role?.company)?.name);
    const title = str(role?.title);
    const loc = rec(r.location);
    const location = [str(loc?.city), str(loc?.region), str(loc?.country_code)].filter(Boolean).join(', ') || null;
    const headline = str(r.description) ?? (title ? `${title}${company ? ` at ${company}` : ''}` : null);
    const skills = arr(r.skills).map(str).filter((s): s is string => !!s);
    leads.push(
      personLead({
        name: str(r.name),
        source: PEOPLE_SEARCH_ID,
        source_ref: profiles[0]!.url,
        profiles,
        headline,
        snippet: [headline, title && company ? `${title} at ${company}` : null, skills.slice(0, 5).join(', ')].filter(Boolean).join(' | '),
        location_text: location,
      }),
    );
  }
  return leads;
}

export const peopleSearch: SourceAdapter = {
  id: PEOPLE_SEARCH_ID,
  costEstimateUsd: 0.02,
  perQuery: false,
  async run(ctx) {
    const r = await callMonid(ctx.monid, 'context.dev', '/people/search', { body: { query: buildPeopleQuery(ctx) } });
    return { leads: parsePeopleSearch(r.output), cost_usd: r.cost_usd };
  },
};
