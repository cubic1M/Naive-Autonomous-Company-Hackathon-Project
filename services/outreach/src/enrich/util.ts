import { normEmail } from '../geo.js';
import { profileFromUrl } from '../profiles.js';
import type { Monid } from '../monid.js';
import { SourceError, type Enricher } from '../sources/types.js';
import type { Lead, Profile, ProfilePlatform } from '../types.js';

/**
 * What an enricher returns. email/phone/cost_usd/profiles are the shared Enricher contract; the optional
 * extras (GitHub knows them for free) can be merged into the lead by callers that understand them.
 */
export type EnrichResult = {
  email: string | null;
  phone: string | null;
  cost_usd: number;
  profiles?: Profile[];
  open_to_work?: boolean;
  headline?: string | null;
  location_text?: string | null;
};
/** An Enricher whose result carries the optional extras above (still assignable to Enricher). */
export interface PersonEnricher extends Omit<Enricher, 'enrich'> {
  enrich(lead: Lead, monid: Monid): Promise<EnrichResult>;
}
export const EMPTY: EnrichResult = { email: null, phone: null, cost_usd: 0 };

export function profileOf(lead: Lead, platform: ProfilePlatform): Profile | null {
  const hit = lead.profiles?.find((p) => p.platform === platform);
  if (hit) return hit;
  const fromUrl = profileFromUrl(lead.profile_url);
  return fromUrl?.platform === platform ? fromUrl : null;
}

/** Handle of a profile on a platform (explicit handle, else the last URL path segment). */
export function handleOf(p: Profile | null): string | null {
  if (!p) return null;
  if (p.handle) return p.handle.replace(/^@/, '');
  try {
    return new URL(p.url).pathname.split('/').filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

/** Undo the usual "name [at] site dot com" obfuscation people use in bios. */
export function deobfuscate(text: string): string {
  return text
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, '@')
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, '.');
}

/** Profiles for every URL in a block of text (bio), minus the profile we started from. */
export function profilesFromText(text: string, exceptUrl?: string): Profile[] {
  const out: Profile[] = [];
  for (const m of text.match(/https?:\/\/[^\s)<>"']+/g) ?? []) {
    const p = profileFromUrl(m.replace(/[.,;]+$/, ''));
    if (p && p.url !== exceptUrl && !out.some((o) => o.url === p.url)) out.push(p);
  }
  return out;
}

export function firstEmail(...vals: unknown[]): string | null {
  for (const v of vals) {
    for (const x of Array.isArray(v) ? v : [v]) {
      if (typeof x === 'string') {
        const e = normEmail(x);
        if (e) return e;
      }
    }
  }
  return null;
}

/** A provider "not found" (free) is an empty result, not an error. */
export function swallowNotFound(e: unknown): EnrichResult {
  if (e instanceof SourceError && /http 404|not_found/i.test(e.message)) return { ...EMPTY, cost_usd: e.cost_usd };
  throw e;
}
