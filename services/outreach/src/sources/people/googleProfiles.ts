import { profileFromUrl } from '../../profiles.js';
import type { Lead } from '../../types.js';
import { arr, callMonid, perQueryRun, rec, str, type SourceAdapter, type SourceContext } from '../types.js';
import { detectCredentials, extractEmails, personLead } from './common.js';

export const GOOGLE_PROFILES_ID = 'monid:litescrape/google/search';

export type RoleFamily = 'legal' | 'software' | 'design' | 'media' | 'notary' | 'writing' | 'gig' | 'general';

const FAMILY_RES: [RoleFamily, RegExp][] = [
  ['notary', /notary|notarize|notarization/i],
  ['legal', /attorney|lawyer|paralegal|legal|counsel|law\b|contract review|terms of service|compliance/i],
  ['software', /developer|engineer|programmer|software|react|typescript|python|devops|frontend|backend|full.?stack|\bcode\b|\bbug\b|data scien/i],
  ['design', /design|logo|illustrat|figma|ui\/ux|\bux\b|brand identity/i],
  ['media', /photo|video|film|camera|editor|videograph/i],
  ['writing', /translat|writer|copywrit|editor|transcri|bookkeep|account|proofread/i],
  ['gig', /sign|ambassador|promo|flyer|canvass|street|deliver|errand|queue|survey|mystery|pickup|stand\b/i],
];

export function roleFamily(text: string): RoleFamily {
  for (const [fam, re] of FAMILY_RES) if (re.test(text)) return fam;
  return 'general';
}

/** Sites worth searching per family, best first. */
const SITES: Record<RoleFamily, string[]> = {
  legal: ['linkedin.com/in', 'avvo.com/attorneys', 'justia.com/lawyers'],
  software: ['github.com', 'linkedin.com/in', 'x.com'],
  design: ['behance.net', 'dribbble.com', 'linkedin.com/in'],
  media: ['instagram.com', 'linkedin.com/in', 'x.com'],
  notary: ['linkedin.com/in', '123notary.com', 'x.com'],
  writing: ['linkedin.com/in', 'x.com', 'contra.com'],
  gig: ['linkedin.com/in', 'x.com', 'instagram.com'],
  general: ['linkedin.com/in', 'x.com', 'instagram.com'],
};

const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);

/** "123 Main St, San Francisco, CA 94105" -> "San Francisco"; "SF" -> "San Francisco". */
export function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  let city = parts.length >= 3 ? parts[parts.length - 2]! : parts.length === 2 ? parts[0]! : (parts[0] ?? null);
  if (!city) return null;
  if (/^(sf|s\.f\.)$/i.test(city)) city = 'San Francisco';
  if (/^(nyc|ny)$/i.test(city)) city = 'New York';
  if (/^la$/i.test(city)) city = 'Los Angeles';
  return /\d{3}/.test(city) ? null : city;
}

type QueryCtx = Pick<SourceContext, 'job' | 'hints' | 'remote'>;

/** Pure: up to 14 (site-restricted and contact-page) Google queries for the job. Remote jobs get no city. */
export function buildGoogleQueries(ctx: QueryCtx): string[] {
  const roles = ctx.hints.roles.length ? ctx.hints.roles : [ctx.job.title];
  const skills = ctx.hints.skills;
  const cred = ctx.hints.credential ?? ctx.job.certification_required;
  const fam = roleFamily([...roles, ...skills, cred ?? '', ctx.hints.roles.length ? '' : ctx.job.title].join(' '));
  const city = ctx.remote ? null : cityFromAddress(ctx.job.address);

  const roleTerm = roles.length > 1 ? `(${roles.slice(0, 3).map(q).join(' OR ')})` : q(roles[0]!);
  const skillTerm = skills.slice(0, 2).map(q).join(' ');
  const loc = city ? q(city) : '';
  const join = (...p: string[]) => p.filter(Boolean).join(' ');

  const out: string[] = [];
  for (const site of SITES[fam].slice(0, 3)) {
    let extra = 'freelance';
    if (site === 'github.com') extra = '("open to work" OR "available for hire")';
    else if (site === 'x.com' || site === 'instagram.com') extra = '(freelance OR "for hire" OR "available")';
    else if (/avvo|justia|123notary/.test(site)) extra = cred ? q(cred.replace(/ (license|licence)$/i, '')) : '';
    out.push(join(`site:${site}`, roleTerm, site === 'github.com' || site.includes('behance') || /avvo|justia/.test(site) ? skillTerm : skillTerm, extra, loc));
  }
  if (cred && fam !== 'notary') out.push(join('site:linkedin.com/in', roleTerm, q(cred), loc));
  out.push(join(`"freelance ${roles[0]}"`, skillTerm, 'portfolio contact', loc));
  out.push(...contactPageQueries(fam, { roleTerm, role: q(roles[0]!), skillTerm, cred, loc, join }));
  return [...new Set(out.map((s) => s.replace(/\s+/g, ' ').trim()))].slice(0, MAX_QUERIES);
}

/** Hard cap on queries per job ($0.00015 each). */
export const MAX_QUERIES = 14;
/** Results requested per query (litescrape: best-effort, 1-100). */
export const RESULTS_PER_QUERY = 20;

interface ExtraCtx {
  roleTerm: string;
  role: string;
  skillTerm: string;
  cred: string | null;
  loc: string;
  join: (...p: string[]) => string;
}

/** Pure: queries aimed at people with a public contact page (solo practices, freelancer sites, directories). */
function contactPageQueries(fam: RoleFamily, c: ExtraCtx): string[] {
  const { join, roleTerm, role, skillTerm, loc } = c;
  const noSocial = '-site:linkedin.com -site:facebook.com';
  switch (fam) {
    case 'legal':
      return [
        join(role, skillTerm, '("law office" OR "law firm" OR PLLC OR Esq)', 'contact', loc, noSocial),
        join('site:lawyers.com', roleTerm, skillTerm, loc),
        join('site:upcounsel.com', roleTerm, skillTerm),
        join('site:martindale.com', roleTerm, skillTerm, loc),
        join('"freelance" ("contract lawyer" OR "contract attorney") email', skillTerm, loc),
        join('"solo practitioner"', roleTerm, skillTerm, '("email me" OR "contact me")', loc),
        join(role, skillTerm, '"attorney at law" "free consultation" contact', loc, noSocial),
      ];
    case 'software':
      return [
        join('site:github.com', '"freelance developer"', 'portfolio', '"contact"', skillTerm, loc),
        join('site:contra.com', roleTerm, skillTerm),
        join('site:toptal.com', roleTerm, skillTerm),
        join(`"freelance ${c.role.replace(/"/g, '')}"`, 'portfolio ("contact me" OR "hire me" OR "email me")', skillTerm, loc, noSocial),
        join('site:github.io', roleTerm, skillTerm, 'contact'),
        join('site:stackoverflow.com/users', roleTerm, skillTerm, '"available for"'),
      ];
    case 'design':
      return [
        join('site:behance.net', roleTerm, skillTerm, loc),
        join('site:dribbble.com', roleTerm, skillTerm, loc),
        join('site:contra.com', roleTerm, skillTerm),
        join(roleTerm, 'portfolio ("contact me" OR "hire me" OR "email me")', skillTerm, loc, noSocial),
        join('"freelance"', roleTerm, '"available for work"', 'email', loc, noSocial),
      ];
    case 'media':
      return [
        join(roleTerm, 'portfolio ("contact me" OR "book me" OR "inquiries")', skillTerm, loc, noSocial),
        join('site:thumbtack.com', roleTerm, loc),
        join('site:contra.com', roleTerm, skillTerm),
        join('"freelance"', roleTerm, 'email', skillTerm, loc, noSocial),
      ];
    case 'writing':
      return [
        join('site:contra.com', roleTerm, skillTerm),
        join(roleTerm, 'portfolio ("contact me" OR "hire me" OR "email me")', skillTerm, loc, noSocial),
        join('"freelance"', roleTerm, 'email', skillTerm, loc, noSocial),
        join('site:upwork.com/freelancers', roleTerm, skillTerm),
      ];
    case 'notary':
      return [
        join('site:thumbtack.com', roleTerm, loc),
        join('"mobile notary"', 'contact email', loc, noSocial),
        join(roleTerm, '("call or email" OR "book now")', loc, noSocial),
      ];
    case 'gig':
      return [
        join('site:thumbtack.com', roleTerm, loc),
        join(roleTerm, 'available ("contact me" OR "email me")', loc, noSocial),
      ];
    default:
      return [
        join('site:thumbtack.com', roleTerm, loc),
        join('site:contra.com', roleTerm, skillTerm),
        join(roleTerm, '"freelance"', '("contact me" OR "email me")', skillTerm, loc, noSocial),
      ];
  }
}

const SITE_SUFFIX = /\s*(?:[-|–·]\s*)?(?:LinkedIn|GitHub|Instagram|Behance|Dribbble|Avvo|Justia|Facebook|Reddit|Contra)\b.*$/i;
const BAD_DOMAINS = /(^|\.)(indeed|glassdoor|ziprecruiter|upwork|fiverr|facebook|youtube|wikipedia|medium|quora|yelp|pinterest|tiktok|amazon|forbes|nytimes|crunchbase|thumbtack|google|apple|microsoft|bing|yahoo|twitter|x|linkedin|github|reddit|instagram)\.com$/i;

/** "Kate Hua (@katehua24) / X" -> {name:"Kate Hua", rest:""}; "Jane Roe - Contract Paralegal | LinkedIn" -> rest "Contract Paralegal". */
export function splitTitle(title: string): { name: string | null; headline: string | null } {
  let t = title.replace(/\s*\(@[^)]+\)\s*\/\s*X\s*$/i, '').replace(/\s+on (?:X|Instagram|Twitter)\b.*$/i, '').trim();
  t = t.replace(SITE_SUFFIX, '').trim();
  const m = t.match(/^(.+?)\s+[-–—|·]\s+(.+)$/);
  const name = (m ? m[1]! : t).replace(/[,|]\s*(?:Esq\.?|J\.?D\.?|CPA|PMP)$/i, '').trim();
  const headline = m ? m[2]!.replace(SITE_SUFFIX, '').trim() : null;
  return { name: name || null, headline: headline || null };
}

function locationFromText(text: string): string | null {
  const m = text.match(/Location:\s*([^·|]+?)(?:\s*·|\.\s|\.$|$)/i) ?? text.match(/\b(?:based in|located in)\s+([A-Z][\w .,'-]{2,40}?)(?:[.,;·|]|\s+(?:and|where|with)\b|$)/);
  return m ? m[1]!.trim() : null;
}

/** Parse the provider output of litescrape /google/search into person leads. Non-profile URLs are dropped. */
export function parseGoogleProfiles(output: unknown): Lead[] {
  const leads: Lead[] = [];
  for (const raw of arr(rec(output)?.organic_results)) {
    const r = rec(raw);
    const link = str(r?.link);
    const title = str(r?.title);
    if (!r || !link || !title) continue;
    const profile = profileFromUrl(link);
    if (!profile) continue;
    if (profile.platform === 'website') {
      let u: URL;
      try {
        u = new URL(link);
      } catch {
        continue;
      }
      if (BAD_DOMAINS.test(u.hostname.replace(/^www\./, '')) || u.pathname.split('/').filter(Boolean).length > 1) continue;
    }
    const snippet = str(r.snippet) ?? '';
    const { name, headline } = splitTitle(title);
    const text = `${title} ${snippet}`;
    leads.push(
      personLead({
        name,
        source: GOOGLE_PROFILES_ID,
        source_ref: profile.url,
        profiles: [profile],
        headline: headline ?? (snippet.split(/\s[·|]\s/)[0] ?? null),
        snippet: `${title} — ${snippet}`,
        location_text: locationFromText(snippet),
        email: extractEmails(snippet)[0] ?? null,
        credentials: detectCredentials(text),
      }),
    );
  }
  return leads;
}

export const googleProfiles: SourceAdapter = {
  id: GOOGLE_PROFILES_ID,
  costEstimateUsd: 0.00015,
  perQuery: true,
  run(ctx) {
    const queries = buildGoogleQueries(ctx);
    return perQueryRun({ ...ctx, queries }, async (query) => {
      const r = await callMonid(ctx.monid, 'litescrape', '/google/search', { queryParams: { q: query, num: RESULTS_PER_QUERY } });
      return { leads: parseGoogleProfiles(r.output), cost_usd: r.cost_usd };
    });
  },
};
