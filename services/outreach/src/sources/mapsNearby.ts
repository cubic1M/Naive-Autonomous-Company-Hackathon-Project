import { toE164 } from '../geo.js';
import type { Lead } from '../types.js';
import { arr, callMonid, cleanUrl, num, perQueryRun, rec, str, type SourceAdapter } from './types.js';

export const MAPS_NEARBY_ID = 'monid:anyapi/maps.search_nearby';

/** Parse the provider `output` of anyapi /maps.search_nearby (lat/lng/rating may be strings). */
export function parseMapsNearby(output: unknown): Lead[] {
  const leads: Lead[] = [];
  for (const raw of arr(rec(rec(output)?.data)?.items)) {
    const r = rec(raw);
    if (!r) continue;
    const name = str(r.name);
    if (!name) continue;
    const cats = arr(r.categories).map(str).filter((s): s is string => !!s);
    const main = str(r.category);
    const categories = [...new Set([...(main ? [main] : []), ...cats])];
    leads.push({
      name,
      kind: 'business',
      email: null,
      phone: toE164(str(r.phone)),
      website: cleanUrl(r.website),
      profile_url: null,
      address: str(r.address),
      lat: num(r.latitude),
      lng: num(r.longitude),
      source: MAPS_NEARBY_ID,
      source_ref: str(r.placeId),
      categories,
      rating: num(r.rating),
      snippet: categories.join(', ').slice(0, 300) || null,
    });
  }
  return leads;
}

export const mapsNearby: SourceAdapter = {
  id: MAPS_NEARBY_ID,
  costEstimateUsd: 0.0013,
  perQuery: true,
  run(ctx) {
    const { lat, lng } = ctx.job;
    return perQueryRun(ctx, async (q) => {
      const r = await callMonid(ctx.monid, 'anyapi', '/maps.search_nearby', {
        body: { query: q, coordinates: { latitude: lat, longitude: lng } },
      });
      return { leads: parseMapsNearby(r.output), cost_usd: r.cost_usd };
    });
  },
};
