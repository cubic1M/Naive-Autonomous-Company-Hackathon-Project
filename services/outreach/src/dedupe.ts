import { normEmail, toE164 } from './geo.js';
import { mergeProfiles, profileFromUrl, profileKeys } from './profiles.js';
import { domainOf } from './sources/types.js';
import type { Lead, Profile } from './types.js';

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Hosts that are not one person's own site (never identity). */
const SHARED_HOSTS = /(^|\.)(facebook|linkedin|instagram|twitter|x|youtube|tiktok|yelp|google|linktr|linktree|github|reddit|wixsite|squarespace|business\.site|weebly)\.[a-z.]+$/;

/** All profiles known for a lead, including its profile_url (generic websites from profile_url are ignored: Maps links etc.). */
function leadProfiles(lead: Lead): Profile[] {
  const fromUrl = profileFromUrl(lead.profile_url);
  const all = fromUrl && fromUrl.platform !== 'website' ? mergeProfiles(lead.profiles, [fromUrl]) : (lead.profiles ?? []);
  return all.filter((p) => p.platform !== 'website' || !SHARED_HOSTS.test(domainOf(p.url) ?? ''));
}

function websiteKey(lead: Lead): string | null {
  const host = domainOf(lead.website);
  return host && !SHARED_HOSTS.test(host) ? `site:${host}` : null;
}

function nameKey(lead: Lead): string | null {
  const loc = norm(lead.address ?? lead.location_text);
  const n = norm(lead.name);
  return n && loc ? `name:${n}|${loc}` : null;
}

/**
 * Stable identity for a lead: linkedin > email > github > x > other profile > phone > source+source_ref > name.
 * Profile handles come first: they survive enrichment finding an email later.
 */
export function dedupeKey(lead: Lead): string {
  const pk = profileKeys(leadProfiles(lead));
  const linkedin = pk.find((k) => k.startsWith('linkedin:'));
  if (linkedin) return linkedin;
  const email = normEmail(lead.email);
  if (email) return `email:${email}`;
  const github = pk.find((k) => k.startsWith('github:'));
  if (github) return github;
  const x = pk.find((k) => k.startsWith('x:'));
  if (x) return x;
  const social = pk.find((k) => k.startsWith('reddit:') || k.startsWith('instagram:'));
  if (social) return social;
  if (pk[0]) return pk[0];
  const phone = toE164(lead.phone);
  if (phone) return `phone:${phone}`;
  if (lead.source_ref) return `ref:${lead.source}:${lead.source_ref}`;
  return `name:${norm(lead.name)}|${norm(lead.address ?? lead.location_text)}`;
}

/** Every identifier we can match a lead on (for merging and for finding earlier saves). */
export function identityKeys(lead: Lead): string[] {
  const ids: string[] = [];
  const email = normEmail(lead.email);
  if (email) ids.push(`email:${email}`);
  ids.push(...profileKeys(leadProfiles(lead)));
  const site = websiteKey(lead);
  if (site) ids.push(site);
  const phone = toE164(lead.phone);
  if (phone) ids.push(`phone:${phone}`);
  if (lead.source_ref) ids.push(`ref:${lead.source}:${lead.source_ref}`);
  const n = nameKey(lead);
  if (n) ids.push(n);
  return ids;
}

function longer(a: string | null | undefined, b: string | null | undefined): string | null {
  if (a && b) return b.length > a.length ? b : a;
  return a ?? b ?? null;
}

function merge(a: Lead, b: Lead): Lead {
  const last = [a.last_active_at, b.last_active_at].filter((x): x is string => Boolean(x)).sort().pop() ?? null;
  const profiles = mergeProfiles(a.profiles, b.profiles);
  const out: Lead = {
    name: a.name ?? b.name,
    kind: a.kind === 'person' || b.kind === 'person' ? 'person' : 'business',
    email: a.email ?? b.email,
    phone: a.phone ?? b.phone,
    website: a.website ?? b.website,
    profile_url: a.profile_url ?? b.profile_url,
    address: a.address ?? b.address,
    lat: a.lat ?? b.lat,
    lng: a.lng ?? b.lng,
    source: a.source,
    source_ref: a.source_ref ?? b.source_ref,
    categories: [...new Set([...a.categories, ...b.categories])],
    rating: a.rating ?? b.rating,
    snippet: longer(a.snippet, b.snippet),
  };
  if (profiles.length) out.profiles = profiles;
  const headline = longer(a.headline, b.headline);
  if (headline) out.headline = headline;
  const loc = a.location_text ?? b.location_text;
  if (loc) out.location_text = loc;
  const creds = [...new Set([...(a.credentials ?? []), ...(b.credentials ?? [])])];
  if (creds.length) out.credentials = creds;
  if (a.open_to_work || b.open_to_work) out.open_to_work = true;
  if (last) out.last_active_at = last;
  return out;
}

/**
 * Merge leads that share any identifier (email, linkedin/github/x/reddit/instagram handle, website host,
 * phone, source ref, name+location), transitively. First-seen order is kept.
 */
export function mergeLeads(leads: Lead[]): Lead[] {
  const groups: (Lead | null)[] = [];
  const index = new Map<string, number>();
  for (const lead of leads) {
    const hits = [...new Set(identityKeys(lead).map((id) => index.get(id)).filter((i): i is number => i !== undefined))].sort((a, b) => a - b);
    let gi: number;
    if (hits.length === 0) {
      gi = groups.length;
      groups.push(lead);
    } else {
      gi = hits[0]!;
      groups[gi] = merge(groups[gi]!, lead);
      for (const other of hits.slice(1)) {
        groups[gi] = merge(groups[gi]!, groups[other]!);
        groups[other] = null;
        for (const [id, i] of index) if (i === other) index.set(id, gi);
      }
    }
    for (const id of identityKeys(groups[gi]!)) if (!index.has(id)) index.set(id, gi);
  }
  return groups.filter((g): g is Lead => g !== null);
}
