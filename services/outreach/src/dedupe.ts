import { normEmail, toE164 } from './geo.js';
import type { Lead } from './types.js';

function norm(s: string | null): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Stable identity for a lead: email > phone > source+source_ref > normalized name+address. */
export function dedupeKey(lead: Lead): string {
  const email = normEmail(lead.email);
  if (email) return `email:${email}`;
  const phone = toE164(lead.phone);
  if (phone) return `phone:${phone}`;
  if (lead.source_ref) return `ref:${lead.source}:${lead.source_ref}`;
  return `name:${norm(lead.name)}|${norm(lead.address)}`;
}

function identifiers(lead: Lead): string[] {
  const ids: string[] = [];
  const email = normEmail(lead.email);
  if (email) ids.push(`email:${email}`);
  const phone = toE164(lead.phone);
  if (phone) ids.push(`phone:${phone}`);
  if (lead.source_ref) ids.push(`ref:${lead.source}:${lead.source_ref}`);
  if (lead.name) ids.push(`name:${norm(lead.name)}|${norm(lead.address)}`);
  return ids;
}

function merge(a: Lead, b: Lead): Lead {
  return {
    name: a.name ?? b.name,
    kind: a.kind,
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
    snippet: a.snippet ?? b.snippet,
  };
}

/** Merge leads sharing any identifier (email, phone, source ref, name+address), transitively. First-seen order is kept. */
export function mergeLeads(leads: Lead[]): Lead[] {
  const groups: (Lead | null)[] = [];
  const index = new Map<string, number>();
  for (const lead of leads) {
    const hits = [...new Set(identifiers(lead).map((id) => index.get(id)).filter((i): i is number => i !== undefined))].sort((a, b) => a - b);
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
    for (const id of identifiers(groups[gi]!)) if (!index.has(id)) index.set(id, gi);
  }
  return groups.filter((g): g is Lead => g !== null);
}
