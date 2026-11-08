import { extractEmails } from '../sources/crawl.js';
import { callMonid, rec, str } from '../sources/types.js';
import { deobfuscate, EMPTY, handleOf, profileOf, profilesFromText, swallowNotFound, type PersonEnricher } from './util.js';

export const X_BIO_ID = 'monid:twitterdata.io/users';

/** X bio (and link) via twitterdata.io /users ($0.00025). Only what the person put in their public bio. */
export const xBio: PersonEnricher = {
  id: X_BIO_ID,
  costEstimateUsd: 0.00025,
  applies: (lead) => !lead.email && profileOf(lead, 'x') !== null,
  async enrich(lead, monid) {
    const x = profileOf(lead, 'x');
    const handle = handleOf(x);
    if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return EMPTY;
    let r;
    try {
      r = await callMonid(monid, 'twitterdata.io', '/users', { queryParams: { username: handle } });
    } catch (e) {
      return swallowNotFound(e);
    }
    const d = rec(rec(r.output)?.data) ?? {};
    const bio = deobfuscate(str(d.bio) ?? '');
    const link = str(d.url);
    const text = `${bio} ${link ?? ''}`;
    return {
      email: extractEmails(bio)[0] ?? null,
      phone: null,
      cost_usd: r.cost_usd,
      profiles: profilesFromText(text, x?.url),
      headline: str(bio.split('\n')[0]),
    };
  },
};
