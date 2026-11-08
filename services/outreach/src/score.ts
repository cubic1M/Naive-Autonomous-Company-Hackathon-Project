import { distanceKm } from './geo.js';
import type { JobForOutreach, Person } from './types.js';

export type Scorable = Pick<
  Person,
  'name' | 'lat' | 'lng' | 'categories' | 'snippet' | 'rating' | 'regular' | 'email' | 'phone' | 'sms_consent' | 'opted_out'
> &
  Partial<Pick<Person, 'kind' | 'headline' | 'location_text' | 'credentials' | 'open_to_work' | 'last_active_at' | 'profiles'>>;

export interface ScoreContext {
  radiusKm: number;
  /** Fallback search phrases when roles is empty. */
  queries?: string[];
  roles?: string[];
  skills?: string[];
  credential?: string | null;
  /** Remote jobs ignore distance entirely. */
  remote?: boolean;
  /** Job city/area for on-site jobs; lets people without coordinates score by location text. */
  locationText?: string | null;
  now?: Date;
}

export const WEIGHTS = {
  match: 0.4,
  distance: 0.2,
  contact: 0.17,
  recency: 0.08,
  openToWork: 0.08,
  rating: 0.07,
  regularBonus: 0.3,
  credentialBoost: 0.2,
  credentialPenalty: 0.3,
  businessPenalty: 0.08,
} as const;

/** Distance from the job in km, or null when either side has no coordinates. */
export function distanceToJob(p: Pick<Person, 'lat' | 'lng'>, job: Pick<JobForOutreach, 'lat' | 'lng'>): number | null {
  if (p.lat === null || p.lng === null || job.lat === null || job.lng === null) return null;
  return distanceKm(job.lat, job.lng, p.lat, p.lng);
}

const MANUAL_HOSTS = ['linkedin', 'x', 'reddit', 'instagram'];
const CRED_NOISE = new Set(['license', 'licensed', 'licence', 'certified', 'certificate', 'certification', 'the', 'and', 'for']);

/** Contactability: email / consenting regular SMS 1, manual DM 0.6, none 0. */
export function contactability(p: Pick<Scorable, 'email' | 'phone' | 'regular' | 'sms_consent' | 'profiles'>): number {
  if (p.email) return 1;
  if (p.regular && p.sms_consent && p.phone) return 1;
  if ((p.profiles ?? []).some((x) => MANUAL_HOSTS.includes(x.platform))) return 0.6;
  return 0;
}

function hayOf(p: Scorable): string {
  return [p.headline ?? '', p.snippet ?? '', ...p.categories, ...(p.credentials ?? [])].join(' ').toLowerCase();
}

function phraseMatch(hay: string, phrase: string): number {
  const ph = phrase.toLowerCase().trim();
  if (!ph || !hay.trim()) return 0;
  if (hay.includes(ph)) return 1;
  const tokens = ph.split(/[^a-z0-9.+#]+/).filter((t) => t.length > 2);
  if (!tokens.length) return 0;
  return tokens.filter((t) => hay.includes(t)).length / tokens.length;
}

/** Best role match, blended with skill coverage when skills are known. 0..1. */
export function fitScore(p: Scorable, ctx: Pick<ScoreContext, 'roles' | 'skills' | 'queries'>): number {
  const hay = `${hayOf(p)} ${(p.name ?? '').toLowerCase()}`;
  const roles = ctx.roles?.length ? ctx.roles : (ctx.queries ?? []);
  const role = roles.reduce((m, r) => Math.max(m, phraseMatch(hay, r)), 0);
  const skills = ctx.skills ?? [];
  if (!skills.length) return role;
  const skill = skills.reduce((n, s) => n + (phraseMatch(hay, s) >= 0.99 ? 1 : 0), 0) / skills.length;
  return 0.7 * role + 0.3 * skill;
}

export function hasCredential(p: Scorable, credential: string): boolean {
  const tokens = credential.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !CRED_NOISE.has(t));
  if (!tokens.length) return false;
  const hay = hayOf(p);
  return tokens.filter((t) => hay.includes(t)).length / tokens.length > 0.5;
}

function recency(iso: string | null | undefined, now: Date): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  const days = Math.max(0, (now.getTime() - t) / 86_400_000);
  if (days <= 30) return 1;
  if (days >= 730) return 0;
  return 1 - (days - 30) / 700;
}

/** Does free-text location mention the job's city/area? */
export function locationMatches(locationText: string | null | undefined, city: string | null | undefined): boolean {
  if (!locationText || !city) return false;
  const l = locationText.toLowerCase();
  const c = city.toLowerCase();
  if (l.includes(c)) return true;
  return /san francisco/.test(c) && /\b(bay area|sf)\b/.test(l);
}

/** 0..1 fit of a person to a job. Pure. */
export function scorePerson(person: Scorable, job: Pick<JobForOutreach, 'lat' | 'lng'>, ctx: ScoreContext): number {
  if (person.opted_out) return 0;
  const now = ctx.now ?? new Date();
  const match = fitScore(person, ctx);
  const contact = contactability(person);
  const rec = recency(person.last_active_at, now);
  const open = person.open_to_work ? 1 : 0;
  const rating = person.rating === null ? 0 : Math.min(1, Math.max(0, (person.rating - 3) / 2));

  let num = WEIGHTS.match * match + WEIGHTS.contact * contact + WEIGHTS.recency * rec + WEIGHTS.openToWork * open + WEIGHTS.rating * rating;
  let den = WEIGHTS.match + WEIGHTS.contact + WEIGHTS.recency + WEIGHTS.openToWork + WEIGHTS.rating;
  if (!ctx.remote) {
    const d = distanceToJob(person, job);
    const distance = d !== null ? Math.max(0, 1 - d / Math.max(ctx.radiusKm, 0.001)) : locationMatches(person.location_text, ctx.locationText) ? 0.5 : 0.2;
    num += WEIGHTS.distance * distance;
    den += WEIGHTS.distance;
  }
  let s = num / den;

  if (ctx.credential) {
    s += hasCredential(person, ctx.credential) ? WEIGHTS.credentialBoost : -WEIGHTS.credentialPenalty;
  }
  if (person.kind === 'business') s -= WEIGHTS.businessPenalty;
  if (person.regular) s += WEIGHTS.regularBonus;
  return Math.min(1, Math.max(0, s));
}
