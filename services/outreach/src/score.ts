import { distanceKm } from './geo.js';
import type { JobForOutreach, Person } from './types.js';

export type Scorable = Pick<
  Person,
  'name' | 'lat' | 'lng' | 'categories' | 'snippet' | 'rating' | 'regular' | 'email' | 'phone' | 'sms_consent' | 'opted_out'
>;

export interface ScoreContext {
  radiusKm: number;
  queries: string[];
}

export const WEIGHTS = { distance: 0.45, keyword: 0.25, rating: 0.1, channel: 0.2, regularBonus: 0.3 } as const;

/** Distance from the job in km, or null when either side has no coordinates. */
export function distanceToJob(p: Pick<Person, 'lat' | 'lng'>, job: Pick<JobForOutreach, 'lat' | 'lng'>): number | null {
  if (p.lat === null || p.lng === null || job.lat === null || job.lng === null) return null;
  return distanceKm(job.lat, job.lng, p.lat, p.lng);
}

function keywordMatch(p: Scorable, queries: string[]): number {
  const hay = [p.name ?? '', p.snippet ?? '', ...p.categories].join(' ').toLowerCase();
  if (!hay.trim() || !queries.length) return 0;
  let best = 0;
  for (const q of queries) {
    const phrase = q.toLowerCase();
    if (hay.includes(phrase)) return 1;
    const tokens = phrase.split(/\s+/).filter((t) => t.length > 2);
    if (!tokens.length) continue;
    const hits = tokens.filter((t) => hay.includes(t)).length;
    best = Math.max(best, hits / tokens.length);
  }
  return best;
}

/** 0..1 relevance of a person to a job. Pure. */
export function scorePerson(person: Scorable, job: Pick<JobForOutreach, 'lat' | 'lng'>, ctx: ScoreContext): number {
  if (person.opted_out) return 0;
  const d = distanceToJob(person, job);
  const distance = d === null ? 0.2 : Math.max(0, 1 - d / Math.max(ctx.radiusKm, 0.001));
  const keyword = keywordMatch(person, ctx.queries);
  const rating = person.rating === null ? 0 : Math.min(1, Math.max(0, (person.rating - 3) / 2));
  const channel = person.email || (person.regular && person.sms_consent && person.phone) ? 1 : 0;
  let s = WEIGHTS.distance * distance + WEIGHTS.keyword * keyword + WEIGHTS.rating * rating + WEIGHTS.channel * channel;
  if (person.regular) s += WEIGHTS.regularBonus;
  return Math.min(1, Math.max(0, s));
}
