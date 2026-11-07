import { normEmail, toE164 } from '../geo.js';
import { callMonid, domainOf, rec, str, type Enricher } from './types.js';
import { SKIP_DOMAINS } from './hunter.js';

export const CRAWL_ID = 'monid:search1api/crawl';

const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|ico|css|js)$|example\.|sentry|wixpress|domain\.com|godaddy|yourdomain|your-?email|schema\.org|@2x|noreply|no-reply/i;
const ROLE = /^(info|jobs|booking|bookings|hello|contact|hire|careers|staffing|events|team|office)@/;

export function extractEmails(text: string): string[] {
  const found = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) ?? [];
  const out: string[] = [];
  for (const f of found) {
    if (BAD_EMAIL.test(f)) continue;
    const e = normEmail(f.replace(/[.]+$/, ''));
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

export function extractPhones(text: string): string[] {
  const found = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g) ?? [];
  const out: string[] = [];
  for (const f of found) {
    const p = toE164(f);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Pages to try, in order. Homepages rarely list an email; contact pages usually do. */
export function crawlTargets(website: string): string[] {
  let origin: string;
  try {
    const u = new URL(website);
    origin = u.origin;
    const home = `${origin}${u.pathname === '/' ? '' : u.pathname}`;
    return [home, `${origin}/contact`, `${origin}/contact-us`];
  } catch {
    return [website];
  }
}

export const crawl: Enricher = {
  id: CRAWL_ID,
  /** Up to 3 pages at $0.001 each. */
  costEstimateUsd: 0.003,
  async enrich(lead, monid) {
    const domain = domainOf(lead.website);
    if (!lead.website || !domain || SKIP_DOMAINS.test(domain)) return { email: null, phone: null, cost_usd: 0 };
    let cost = 0;
    let phone: string | null = null;
    let lastError: unknown = null;
    for (const url of crawlTargets(lead.website)) {
      let content = '';
      try {
        const r = await callMonid(monid, 'search1api', '/crawl', { body: { url } });
        cost += r.cost_usd;
        content = str(rec(rec(r.output)?.results)?.content) ?? '';
      } catch (e) {
        lastError = e; // 404 / 502 on one page: try the next
        continue;
      }
      phone ??= extractPhones(content)[0] ?? null;
      const emails = extractEmails(content);
      const email = emails.find((e) => ROLE.test(e)) ?? emails.find((e) => e.endsWith(`@${domain}`)) ?? emails[0] ?? null;
      if (email) return { email, phone, cost_usd: cost };
    }
    if (cost === 0 && lastError) throw lastError;
    return { email: null, phone, cost_usd: cost };
  },
};
