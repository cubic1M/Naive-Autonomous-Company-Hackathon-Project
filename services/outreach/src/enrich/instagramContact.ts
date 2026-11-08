import { toE164 } from '../geo.js';
import { profileFromUrl } from '../profiles.js';
import { arr, callMonid, rec, str } from '../sources/types.js';
import type { Profile } from '../types.js';
import { EMPTY, firstEmail, handleOf, profileOf, swallowNotFound, type PersonEnricher } from './util.js';

export const INSTAGRAM_ID = 'monid:anyapi/instagram.profile_contact';

/**
 * The public business contact (email/phone behind the profile's Contact button) via anyapi
 * /instagram.profile_contact ($0.00175 default route). Only what the account published.
 */
export const instagramContact: PersonEnricher = {
  id: INSTAGRAM_ID,
  costEstimateUsd: 0.0025,
  applies: (lead) => !lead.email && profileOf(lead, 'instagram') !== null,
  async enrich(lead, monid) {
    const handle = handleOf(profileOf(lead, 'instagram'));
    if (!handle || !/^[A-Za-z0-9._]{1,30}$/.test(handle)) return EMPTY;
    let r;
    try {
      r = await callMonid(monid, 'anyapi', '/instagram.profile_contact', { body: { handle } });
    } catch (e) {
      return swallowNotFound(e);
    }
    const out = rec(r.output);
    const d = rec(out?.data);
    if (!d || out?.found === false) return { ...EMPTY, cost_usd: r.cost_usd };
    const profiles: Profile[] = [];
    const site = profileFromUrl(str(d.externalUrl));
    if (site) profiles.push(site);
    return {
      email: firstEmail(d.publicEmail, d.emails),
      phone: toE164(str(d.publicPhone) ?? str(arr(d.phones)[0])),
      cost_usd: r.cost_usd,
      profiles,
      headline: str(d.bio)?.split('\n')[0] ?? null,
    };
  },
};
