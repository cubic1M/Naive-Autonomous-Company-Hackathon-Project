import { profileFromUrl } from '../../profiles.js';
import type { Lead, Profile } from '../../types.js';
import { cleanUrl } from '../types.js';

export const OPEN_TO_WORK_RE = /open to work|freelanc|for hire|available for|contract(or)?\b|consult/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL_RE = /https?:\/\/[^\s)\]>"'<]+/gi;

const CREDENTIALS: [RegExp, string][] = [
  [/\bbar (?:admitted|licensed|member|number|no\b)|\bstate bar\b|\bmember of the .{0,20}bar\b/i, 'Bar member'],
  [/attorney at law|\bEsq\b/i, 'Attorney at Law'],
  [/notary/i, 'Notary Public'],
  [/\bCPA\b/, 'CPA'],
  [/\blicensed\b/i, 'Licensed'],
];

export function detectCredentials(text: string): string[] {
  return CREDENTIALS.filter(([re]) => re.test(text)).map(([, label]) => label);
}

export function isOpenToWork(text: string): boolean {
  return OPEN_TO_WORK_RE.test(text);
}

/** Emails a person published in their own bio/post. */
export function extractEmails(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase().replace(/[.,;]+$/, '')))];
}

/** Profiles for every URL in a text blob (portfolio sites, github links...). */
export function profilesFromText(text: string | null | undefined, skipHosts: RegExp = /^$/): Profile[] {
  const out: Profile[] = [];
  for (const m of text?.match(URL_RE) ?? []) {
    const url = m.replace(/[.,;:!?]+$/, '');
    if (skipHosts.test(url)) continue;
    const p = profileFromUrl(url);
    if (p && !out.some((o) => o.url === p.url)) out.push(p);
  }
  return out;
}

export function addProfile(list: Profile[], p: Profile | null): void {
  if (p && !list.some((o) => o.url === p.url)) list.push(p);
}

/** First non-website profile url, else the first profile url. */
export function primaryProfileUrl(profiles: Profile[]): string | null {
  return (profiles.find((p) => p.platform !== 'website') ?? profiles[0])?.url ?? null;
}

export function firstWebsite(profiles: Profile[]): string | null {
  const w = profiles.find((p) => p.platform === 'website');
  return w ? cleanUrl(w.url) : null;
}

export interface PersonInit {
  name: string | null;
  source: string;
  source_ref: string | null;
  profiles: Profile[];
  headline?: string | null;
  snippet?: string | null;
  location_text?: string | null;
  email?: string | null;
  open_to_work?: boolean;
  last_active_at?: string | null;
  credentials?: string[];
}

export function personLead(i: PersonInit): Lead {
  const text = `${i.headline ?? ''} ${i.snippet ?? ''}`;
  return {
    name: i.name,
    kind: 'person',
    email: i.email ?? null,
    phone: null,
    website: firstWebsite(i.profiles),
    profile_url: primaryProfileUrl(i.profiles),
    address: null,
    lat: null,
    lng: null,
    source: i.source,
    source_ref: i.source_ref,
    categories: [],
    rating: null,
    snippet: (i.snippet ?? i.headline ?? '').slice(0, 300) || null,
    profiles: i.profiles,
    headline: i.headline ? i.headline.slice(0, 200) : null,
    location_text: i.location_text ?? null,
    credentials: i.credentials ?? detectCredentials(text),
    open_to_work: i.open_to_work ?? isOpenToWork(text),
    last_active_at: i.last_active_at ?? null,
  };
}

export function isoFromUnix(sec: number | null): string | null {
  return sec && sec > 0 ? new Date(sec * 1000).toISOString() : null;
}
