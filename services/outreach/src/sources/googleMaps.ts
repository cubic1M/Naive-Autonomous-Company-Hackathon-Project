import { toE164 } from '../geo.js';
import type { Lead } from '../types.js';
import { arr, callMonid, cleanUrl, num, perQueryRun, rec, str, type SourceAdapter } from './types.js';

export const GOOGLE_MAPS_ID = 'monid:litescrape/google/maps';

/** Parse the provider `output` of litescrape /google/maps. */
export function parseGoogleMaps(output: unknown): Lead[] {
  const leads: Lead[] = [];
  for (const raw of arr(rec(output)?.local_results)) {
    const r = rec(raw);
    if (!r) continue;
    if (r.permanently_closed === true) continue;
    const name = str(r.title);
    if (!name) continue;
    const gps = rec(r.gps_coordinates);
    const types = arr(r.types).map(str).filter((s): s is string => !!s);
    const main = str(r.type);
    const categories = [...new Set([...(main ? [main] : []), ...types])];
    leads.push({
      name,
      kind: 'business',
      email: null,
      phone: toE164(str(r.phone)),
      website: cleanUrl(r.website),
      profile_url: null,
      address: str(r.address),
      lat: num(gps?.latitude),
      lng: num(gps?.longitude),
      source: GOOGLE_MAPS_ID,
      source_ref: str(r.place_id),
      categories,
      rating: num(r.rating),
      snippet: categories.join(', ').slice(0, 300) || null,
    });
  }
  return leads;
}

export const googleMaps: SourceAdapter = {
  id: GOOGLE_MAPS_ID,
  costEstimateUsd: 0.00015,
  perQuery: true,
  run(ctx) {
    const { lat, lng } = ctx.job;
    return perQueryRun(ctx, async (q) => {
      const r = await callMonid(ctx.monid, 'litescrape', '/google/maps', {
        queryParams: { q, type: 'search', ll: `@${lat},${lng},13z` },
      });
      return { leads: parseGoogleMaps(r.output), cost_usd: r.cost_usd };
    });
  },
};
