/**
 * Demand by job family (spec section 9): what customers asked for in the last 7 days against the 7 before, a
 * projection for the next 7, the jobs we failed to fill, and the pre-vetted target that follows from them.
 */
import { distanceKm } from '../../outreach/src/geo.js';
import { FAMILIES, FAMILY_KEYS, PIER70, RADIUS_KM, type Family } from './families.js';
import { DAY_MS } from './time.js';
import type { JobRow } from './types.js';

export type DemandFamily = Family | 'other';
export const DEMAND_FAMILIES: DemandFamily[] = [...FAMILY_KEYS, 'other'];

const NOTARY = /\bnotar(y|ies|ize|ized|izing|ization)\b/;
const LEGAL = /\b(attorney|lawyer|legal|contract review|terms of service|privacy policy)\b/;
const DEV = /\b(developer|code|coding|bug|deploy|react|next\.?js|typescript|frontend|backend)\b/;

export function classifyJob(j: Pick<JobRow, 'title' | 'instructions' | 'certification_required' | 'lat' | 'lng' | 'remote'>): DemandFamily {
  const text = `${j.title} ${j.instructions} ${j.certification_required ?? ''}`.toLowerCase();
  if (NOTARY.test(text)) return 'sf_notaries';
  if (LEGAL.test(text)) return 'ca_attorneys';
  if (DEV.test(text)) return 'developers';
  if (!j.remote && j.lat !== null && j.lng !== null && distanceKm(j.lat, j.lng, PIER70.lat, PIER70.lng) <= RADIUS_KM) return 'pier70_gigs';
  return 'other';
}

export interface FamilyDemand {
  last_7d: number;
  prior_7d: number;
  projected_next_7d: number;
  unfilled_7d: number;
}

export interface Demand {
  by_family: Record<DemandFamily, FamilyDemand>;
  /** The most requested job titles of the last 30 days, lowercased. Internal: never quoted to prospects. */
  top_requested: { title: string; count: number }[];
}

const STUCK_MS = 15 * 60_000;

/** `jobs` should cover the last 30 days (top_requested); the weekly counts use the last 14. */
export function demandFrom(jobs: JobRow[], now: Date): Demand {
  const t = now.getTime();
  const by = Object.fromEntries(DEMAND_FAMILIES.map((f) => [f, { last_7d: 0, prior_7d: 0, projected_next_7d: 0, unfilled_7d: 0 }])) as Record<DemandFamily, FamilyDemand>;
  const titles = new Map<string, number>();
  for (const j of jobs) {
    const age = t - j.created_at.getTime();
    if (age < 0) continue;
    if (age <= 30 * DAY_MS) {
      const key = j.title.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
      if (key) titles.set(key, (titles.get(key) ?? 0) + 1);
    }
    const d = by[classifyJob(j)];
    if (age <= 7 * DAY_MS) {
      d.last_7d++;
      const stuck = j.status === 'outreach' && t - j.updated_at.getTime() >= STUCK_MS;
      if (!j.worker_id && (j.status === 'expired' || j.status === 'cancelled' || stuck)) d.unfilled_7d++;
    } else if (age <= 14 * DAY_MS) {
      d.prior_7d++;
    }
  }
  for (const d of Object.values(by)) d.projected_next_7d = d.last_7d + Math.max(0, d.last_7d - d.prior_7d);
  const top_requested = [...titles]
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, 5);
  return { by_family: by, top_requested };
}

export const TARGET_MAX = 60;

/** Three pre-vetted people per expected job plus every job we failed to fill, never below the family's floor. */
export function targetFor(family: Family, d: FamilyDemand): number {
  return Math.max(FAMILIES[family].floor, Math.min(TARGET_MAX, 3 * (d.projected_next_7d + d.unfilled_7d)));
}
