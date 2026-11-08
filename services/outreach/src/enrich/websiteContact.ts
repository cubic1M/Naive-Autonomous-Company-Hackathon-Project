import { domainOf } from '../sources/types.js';
import { callMonid, rec, str } from '../sources/types.js';
import { extractEmails, extractPhones } from '../sources/crawl.js';
import { SKIP_DOMAINS } from '../sources/hunter.js';
import type { Lead } from '../types.js';
import { EMPTY, deobfuscate, profileOf, type PersonEnricher } from './util.js';

export const WEBSITE_CONTACT_ID = 'monid:search1api/crawl#person';

const ROLE = /^(info|jobs|booking|bookings|hello|contact|hire|careers|work|inquiries|enquiries|office|team)@/;

export function personSite(lead: Lead): string | null {
  const site = profileOf(lead, 'website')?.url ?? lead.website;
  const d = domainOf(site);
  return site && d && !SKIP_DOMAINS.test(d) ? site : null;
}

/** Home, /contact, /about of the person's own site. */
export function siteTargets(site: string): string[] {
  try {
    const u = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
    return [u.origin, `${u.origin}/contact`, `${u.origin}/about`];
  } catch {
    return [site];
  }
}

/** Prefer the person's own domain, then role addresses, then whatever the page published. */
export function pickSiteEmail(emails: string[], domain: string): string | null {
  return emails.find((e) => e.endsWith(`@${domain}`) && !ROLE.test(e)) ?? emails.find((e) => e.endsWith(`@${domain}`)) ?? emails.find((e) => ROLE.test(e)) ?? emails[0] ?? null;
}

/** Crawl the person's own site (search1api /crawl, $0.001/page, stops at the first email). */
export const websiteContact: PersonEnricher = {
  id: WEBSITE_CONTACT_ID,
  costEstimateUsd: 0.003,
  applies: (lead) => !lead.email && personSite(lead) !== null,
  async enrich(lead, monid) {
    const site = personSite(lead);
    const domain = domainOf(site);
    if (!site || !domain) return EMPTY;
    let cost = 0;
    let phone: string | null = null;
    let lastError: unknown = null;
    for (const url of siteTargets(site)) {
      let content = '';
      try {
        const r = await callMonid(monid, 'search1api', '/crawl', { body: { url } });
        cost += r.cost_usd;
        content = deobfuscate(str(rec(rec(r.output)?.results)?.content) ?? '');
      } catch (e) {
        lastError = e;
        continue;
      }
      phone ??= extractPhones(content)[0] ?? null;
      const email = pickSiteEmail(extractEmails(content), domain);
      if (email) return { email, phone, cost_usd: cost };
    }
    if (cost === 0 && lastError) throw lastError;
    return { email: null, phone, cost_usd: cost };
  },
};
