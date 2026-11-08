import { profileFromUrl } from '../../profiles.js';
import type { Lead, Profile } from '../../types.js';
import { arr, callMonid, perQueryRun, rec, str, type SourceAdapter, type SourceContext } from '../types.js';
import { addProfile, extractEmails, personLead, profilesFromText } from './common.js';
import { cityFromAddress } from './googleProfiles.js';

export const X_USERS_ID = 'monid:anyapi/twitter.search_users';
const T_CO = /^https?:\/\/t\.co\//i;

/** Pure: up to 6 bio keyword queries ("<role> freelance", "for hire", "email me", second role, skill) (+ city when on-site). */
export function buildXQueries(ctx: Pick<SourceContext, 'job' | 'hints' | 'remote'>): string[] {
  const role = ctx.hints.roles[0] ?? ctx.job.title;
  const city = ctx.remote ? null : cityFromAddress(ctx.job.address);
  const c = city ? ` ${city}` : '';
  const alt = ctx.hints.roles[1];
  const skill = ctx.hints.skills[0];
  const qs = [`${role} freelance${c}`, `${role} for hire${c}`, `${role} "dm for work" OR "email me"${c}`, `independent ${role} contact${c}`];
  if (alt) qs.push(`${alt} freelance${c}`);
  if (skill) qs.push(`${role} ${skill}${c}`);
  return [...new Set(qs)].slice(0, 6);
}

export function parseXUsers(output: unknown): Lead[] {
  const leads: Lead[] = [];
  for (const raw of arr(rec(rec(output)?.data)?.users)) {
    const u = rec(raw);
    const username = str(u?.username);
    if (!u || !username) continue;
    const x = profileFromUrl(str(u.profileUrl) ?? `https://x.com/${username}`);
    if (!x) continue;
    const bio = str(u.bio) ?? '';
    const profiles: Profile[] = [x];
    for (const p of profilesFromText(bio, T_CO)) addProfile(profiles, p);
    leads.push(
      personLead({
        name: str(u.name),
        source: X_USERS_ID,
        source_ref: str(u.id) ?? username.toLowerCase(),
        profiles,
        headline: bio.replace(/\s+/g, ' ').slice(0, 200) || null,
        snippet: bio.replace(/\s+/g, ' '),
        location_text: str(u.location),
        email: extractEmails(bio)[0] ?? null,
      }),
    );
  }
  return leads;
}

export const xUsers: SourceAdapter = {
  id: X_USERS_ID,
  costEstimateUsd: 0.0007,
  perQuery: true,
  run(ctx) {
    const queries = buildXQueries(ctx);
    return perQueryRun({ ...ctx, queries }, async (query) => {
      const r = await callMonid(ctx.monid, 'anyapi', '/twitter.search_users', { body: { query } });
      return { leads: parseXUsers(r.output), cost_usd: r.cost_usd };
    });
  },
};
