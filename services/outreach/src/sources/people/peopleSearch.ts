import { profileFromUrl } from '../../profiles.js';
import type { Lead, Profile } from '../../types.js';
import { arr, callMonid, rec, SourceError, str, type SourceAdapter, type SourceContext } from '../types.js';
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

/** Pure: a second, differently-angled phrasing (independent consultants with a web presence). */
export function buildPeopleQuery2(ctx: Pick<SourceContext, 'job' | 'hints' | 'remote'>): string {
  const role = ctx.hints.roles[2] ?? ctx.hints.roles[1] ?? ctx.hints.roles[0] ?? ctx.job.title;
  let q = `independent ${role} with own practice or personal website`;
  if (ctx.hints.skills[0]) q += `, ${ctx.hints.skills[0]}`;
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
  costEstimateUsd: 0.04, // two pages at $0.02
  perQuery: false,
  async run(ctx) {
    const queries = [...new Set([buildPeopleQuery(ctx), buildPeopleQuery2(ctx)])];
    const leads: Lead[] = [];
    let cost = 0;
    let lastErr: SourceError | null = null;
    let ok = 0;
    for (const query of queries) {
      try {
        const r = await callMonid(ctx.monid, 'context.dev', '/people/search', { body: { query } });
        leads.push(...parsePeopleSearch(r.output));
        cost += r.cost_usd;
        ok++;
      } catch (e) {
        lastErr = e instanceof SourceError ? e : new SourceError(e instanceof Error ? e.message : String(e));
        cost += lastErr.cost_usd;
      }
    }
    if (ok === 0 && lastErr) throw new SourceError(lastErr.message, cost);
    return { leads, cost_usd: cost };
  },
};
