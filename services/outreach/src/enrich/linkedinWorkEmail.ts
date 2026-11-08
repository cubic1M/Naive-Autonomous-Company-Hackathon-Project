import { arr, callMonid, rec } from '../sources/types.js';
import { EMPTY, firstEmail, profileOf, swallowNotFound, type PersonEnricher } from './util.js';

export const LINKEDIN_WORK_EMAIL_ID = 'monid:contactout/v1/people/linkedin/work-email';

/**
 * WORK email for a LinkedIn profile via ContactOut's contacts-only endpoint. Billed $0.10 when an address
 * is found, free on a 404 miss. Never the personal-email endpoints. Last resort: runs only when nothing
 * cheaper found an email.
 *
 * Only accepted when the email is on the person's OWN domain (their solo practice / studio website).
 * An employer address (e.g. someone@oracle.com) is never used: pitching a side gig to someone's employer
 * inbox is inappropriate, and those addresses are often stale.
 */
function host(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True when the email's domain is (a subdomain of) one of the lead's own website hosts. */
export function isOwnDomainEmail(email: string, lead: Parameters<PersonEnricher['enrich']>[0]): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  const hosts = [lead.website, ...(lead.profiles ?? []).filter((p) => p.platform === 'website').map((p) => p.url)]
    .filter((u): u is string => Boolean(u))
    .map(host)
    .filter((h): h is string => Boolean(h));
  return hosts.some((h) => domain === h || domain.endsWith(`.${h}`) || h.endsWith(`.${domain}`));
}
export const linkedinWorkEmail: PersonEnricher = {
  id: LINKEDIN_WORK_EMAIL_ID,
  costEstimateUsd: 0.1,
  // Needs a LinkedIn profile AND an own website to compare the email domain against.
  applies: (lead) => !lead.email && profileOf(lead, 'linkedin') !== null && (Boolean(lead.website) || Boolean(lead.profiles?.some((p) => p.platform === 'website'))),
  async enrich(lead, monid) {
    const li = profileOf(lead, 'linkedin');
    if (!li) return EMPTY;
    let r;
    try {
      r = await callMonid(monid, 'contactout', '/v1/people/linkedin/work-email', { queryParams: { profile: li.url } });
    } catch (e) {
      return swallowNotFound(e);
    }
    const out = rec(r.output);
    const p = rec(out?.profile) ?? rec(out?.data) ?? out;
    // work_email only: ignore `email` unless work_email is absent (the endpoint returns work addresses only).
    const email = firstEmail(arr(p?.work_email)) ?? (p?.work_email === undefined ? firstEmail(arr(p?.email)) : null);
    return { email: email && isOwnDomainEmail(email, lead) ? email : null, phone: null, cost_usd: r.cost_usd };
  },
};
