import { normEmail } from '../geo.js';
import { profileFromUrl } from '../profiles.js';
import { SKIP_DOMAINS } from '../sources/hunter.js';
import { cleanUrl, domainOf, rec, str } from '../sources/types.js';
import type { Profile } from '../types.js';
import { EMPTY, handleOf, profileOf, type PersonEnricher } from './util.js';

/** A blog on any TLD is still the person's own site (profileFromUrl only knows common TLDs). */
function websiteOf(raw: string): Profile | null {
  const origin = cleanUrl(raw.includes('://') ? raw : `https://${raw}`);
  const host = domainOf(origin);
  if (!origin || !host || !host.includes('.') || SKIP_DOMAINS.test(host)) return null;
  return { platform: 'website', url: new URL(origin).origin, handle: null };
}

export const GITHUB_ID = 'github:api/users';

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Free GitHub REST profile lookup (no key; 60 requests/hour per IP). Public fields only: the email the
 * person chose to show, their blog, linked X account and "hireable" flag.
 */
export function makeGithubProfile(fetchImpl: FetchLike = fetch as unknown as FetchLike): PersonEnricher {
  return {
    id: GITHUB_ID,
    costEstimateUsd: 0,
    applies: (lead) => profileOf(lead, 'github') !== null,
    async enrich(lead) {
      const login = handleOf(profileOf(lead, 'github'));
      if (!login || !/^[A-Za-z0-9-]{1,39}$/.test(login)) return EMPTY;
      const res = await fetchImpl(`https://api.github.com/users/${login}`, {
        headers: { 'User-Agent': 'operis-outreach', Accept: 'application/vnd.github+json' },
      });
      if (res.status === 404) return EMPTY;
      if (!res.ok) throw new Error(`github users/${login}: http ${res.status}`);
      const u = rec(await res.json());
      if (!u) return EMPTY;

      const profiles: Profile[] = [];
      const blog = str(u.blog);
      const site = blog ? (profileFromUrl(blog) ?? websiteOf(blog)) : null;
      if (site) profiles.push(site);
      const tw = str(u.twitter_username);
      if (tw && /^[A-Za-z0-9_]{1,15}$/.test(tw)) profiles.push({ platform: 'x', url: `https://x.com/${tw.toLowerCase()}`, handle: tw.toLowerCase() });

      return {
        email: normEmail(str(u.email)),
        phone: null,
        cost_usd: 0,
        profiles,
        open_to_work: u.hireable === true,
        location_text: str(u.location),
        headline: str(u.bio),
      };
    },
  };
}

export const githubProfile: PersonEnricher = makeGithubProfile();
