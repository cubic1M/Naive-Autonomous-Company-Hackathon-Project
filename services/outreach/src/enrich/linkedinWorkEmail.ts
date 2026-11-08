import { arr, callMonid, rec } from '../sources/types.js';
import { EMPTY, firstEmail, profileOf, swallowNotFound, type PersonEnricher } from './util.js';

export const LINKEDIN_WORK_EMAIL_ID = 'monid:contactout/v1/people/linkedin/work-email';

/**
 * WORK email for a LinkedIn profile via ContactOut's contacts-only endpoint. Billed $0.10 when an address
 * is found, free on a 404 miss. Never the personal-email endpoints. Last resort: runs only when nothing
 * cheaper found an email.
 */
export const linkedinWorkEmail: PersonEnricher = {
  id: LINKEDIN_WORK_EMAIL_ID,
  costEstimateUsd: 0.1,
  applies: (lead) => !lead.email && profileOf(lead, 'linkedin') !== null,
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
    return { email, phone: null, cost_usd: r.cost_usd };
  },
};
