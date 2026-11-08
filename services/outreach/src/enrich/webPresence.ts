import { profileFromUrl } from '../profiles.js';
import { arr, callMonid, domainOf, rec, str } from '../sources/types.js';
import type { Lead, Profile } from '../types.js';
import { crawlSiteContact, personSite } from './websiteContact.js';
import { EMPTY, type EnrichResult, type PersonEnricher } from './util.js';

export const WEB_PRESENCE_ID = 'monid:litescrape/google/search#presence';
const SEARCH_COST = 0.00015;
const CRAWL_COST = 0.003;
/** Mailbox providers whose addresses are personal-by-design: accepted only when printed on the person's own site. */
export const GENERIC_MAILBOXES = new Set(['gmail.com', 'outlook.com', 'icloud.com', 'proton.me', 'protonmail.com', 'yahoo.com', 'hotmail.com']);
const SKIP_NAME = /\b(llc|inc|ltd|team|studio|agency|group|law firm|company|co\.)\b/i;

/** Pure: "Leslie Werner" attorney contact -site:linkedin.com */
export function buildPresenceQuery(lead: Pick<Lead, 'name' | 'headline' | 'snippet' | 'categories'>): string | null {
  const name = lead.name?.replace(/[(),"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name || name.split(' ').length < 2 || name.length > 60 || SKIP_NAME.test(name)) return null;
  const role = bestRoleWord(`${lead.headline ?? ''} ${lead.categories?.join(' ') ?? ''} ${lead.snippet ?? ''}`);
  return [`"${name}"`, role, '(contact OR email)', '-site:linkedin.com'].filter(Boolean).join(' ');
}

const ROLE_WORDS: [RegExp, string][] = [
  [/attorney|lawyer|counsel|esq\b/i, 'attorney'],
  [/paralegal/i, 'paralegal'],
  [/notary/i, 'notary'],
  [/developer|engineer|programmer/i, 'developer'],
  [/designer|illustrat/i, 'designer'],
  [/photograph/i, 'photographer'],
  [/video|film/i, 'videographer'],
  [/translat/i, 'translator'],
  [/writer|copywrit/i, 'writer'],
  [/editor|proofread/i, 'editor'],
  [/bookkeep|account|cpa/i, 'accountant'],
  [/consultant/i, 'consultant'],
  [/freelanc/i, 'freelance'],
];

export function bestRoleWord(text: string): string {
  return ROLE_WORDS.find(([re]) => re.test(text))?.[1] ?? '';
}

function lastNameOf(name: string): string {
  return name.replace(/,.*$/, '').trim().split(/\s+/).pop()!.toLowerCase().replace(/[^\p{L}]/gu, '');
}

/** Pure: the first search result that is the person's own site (or a directory page about them). */
export function pickOwnSite(output: unknown, name: string): Profile | null {
  const last = lastNameOf(name);
  if (last.length < 3) return null;
  for (const raw of arr(rec(output)?.organic_results)) {
    const r = rec(raw);
    const link = str(r?.link);
    const p = profileFromUrl(link);
    if (!r || !link || !p || (p.platform !== 'website' && p.platform !== 'directory')) continue;
    const host = domainOf(link) ?? '';
    if (/(^|\.)(facebook|youtube|wikipedia|zoominfo|yelp|linkedin|instagram|twitter|x|indeed|glassdoor|crunchbase|bloomberg|rocketreach|signalhire|dnb|manta|yellowpages|mapquest|bbb)\./.test(`${host}.`)) continue;
    const hay = `${str(r.title) ?? ''} ${str(r.snippet) ?? ''} ${host}`.toLowerCase().replace(/[^\p{L}\s.]/gu, '');
    if (hay.includes(last)) return p;
  }
  return null;
}

/** Emails on the person's own domain, or a generic mailbox printed on their site. */
export function acceptableEmail(email: string, siteDomain: string): boolean {
  const d = email.split('@')[1]?.toLowerCase();
  if (!d) return false;
  return d === siteDomain || d.endsWith(`.${siteDomain}`) || GENERIC_MAILBOXES.has(d);
}

/**
 * Find a person's own web page with one Google lookup, then crawl it for a published contact email.
 * ~$0.00015 for the lookup + up to $0.003 for the crawl.
 */
export const webPresence: PersonEnricher = {
  id: WEB_PRESENCE_ID,
  costEstimateUsd: SEARCH_COST + CRAWL_COST,
  applies: (lead) => !lead.email && lead.kind === 'person' && personSite(lead) === null && buildPresenceQuery(lead) !== null,
  async enrich(lead, monid): Promise<EnrichResult> {
    const q = buildPresenceQuery(lead);
    if (!q || !lead.name) return EMPTY;
    const s = await callMonid(monid, 'litescrape', '/google/search', { queryParams: { q, num: 10 } });
    const site = pickOwnSite(s.output, lead.name);
    if (!site) return { ...EMPTY, cost_usd: s.cost_usd };
    const domain = domainOf(site.url);
    const base: EnrichResult = { ...EMPTY, cost_usd: s.cost_usd, profiles: [site] };
    if (!domain || site.platform !== 'website') return base; // directory pages: keep the link, don't crawl a shared domain
    try {
      const c = await crawlSiteContact(site.url, monid, (e) => acceptableEmail(e, domain));
      return { ...base, email: c.email, phone: c.phone, cost_usd: s.cost_usd + c.cost_usd };
    } catch {
      return base;
    }
  },
};
