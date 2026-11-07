import { randomUUID } from 'node:crypto';
import { distanceKm, normEmail, toE164 } from '../geo.js';
import type { Repo } from '../repo.js';
import type { Channel, JobForOutreach, Lead, OutreachRow, OutreachStatus, Person } from '../types.js';

/** In-memory Repo for tests and local dev. Same semantics as PostgresRepo. */
export class InMemoryRepo implements Repo {
  readonly jobs = new Map<string, JobForOutreach>();
  readonly people = new Map<string, Person>();
  readonly outreach: OutreachRow[] = [];
  readonly costs: { job_id: string; kind: string; amount_usd: number; ref: string }[] = [];

  addJob(job: JobForOutreach): void {
    this.jobs.set(job.id, job);
  }

  /** Seed a person directly (e.g. a regular). */
  addPerson(p: Partial<Person> & { dedupe_key: string }): Person {
    const person: Person = {
      id: p.id ?? randomUUID(),
      name: p.name ?? null,
      email: normEmail(p.email ?? null),
      phone: toE164(p.phone ?? null),
      source: p.source ?? 'seed',
      opted_out: p.opted_out ?? false,
      kind: p.kind ?? 'person',
      website: p.website ?? null,
      profile_url: p.profile_url ?? null,
      address: p.address ?? null,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      categories: p.categories ?? [],
      rating: p.rating ?? null,
      snippet: p.snippet ?? null,
      regular: p.regular ?? false,
      sms_consent: p.sms_consent ?? false,
      last_contacted_at: p.last_contacted_at ?? null,
      dedupe_key: p.dedupe_key,
    };
    this.people.set(person.id, person);
    return person;
  }

  async getJob(id: string): Promise<JobForOutreach | null> {
    return this.jobs.get(id) ?? null;
  }

  async listRegularsNear(lat: number, lng: number, radiusKm: number, limit: number): Promise<Person[]> {
    return [...this.people.values()]
      .filter((p) => p.regular && !p.opted_out && p.lat !== null && p.lng !== null)
      .map((p) => ({ p, d: distanceKm(lat, lng, p.lat!, p.lng!) }))
      .filter(({ d }) => d <= radiusKm)
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map(({ p }) => p);
  }

  async upsertLead(lead: Lead, dedupeKey: string): Promise<Person> {
    const existing = [...this.people.values()].find((p) => p.dedupe_key === dedupeKey);
    const email = normEmail(lead.email);
    const phone = toE164(lead.phone);
    if (existing) {
      const merged: Person = {
        ...existing,
        name: existing.name ?? lead.name,
        email: existing.email ?? email,
        phone: existing.phone ?? phone,
        website: existing.website ?? lead.website,
        profile_url: existing.profile_url ?? lead.profile_url,
        address: existing.address ?? lead.address,
        lat: existing.lat ?? lead.lat,
        lng: existing.lng ?? lead.lng,
        categories: [...new Set([...existing.categories, ...lead.categories])],
        rating: existing.rating ?? lead.rating,
        snippet: existing.snippet ?? lead.snippet,
      };
      this.people.set(merged.id, merged);
      return merged;
    }
    return this.addPerson({
      name: lead.name,
      email,
      phone,
      source: lead.source,
      kind: lead.kind,
      website: lead.website,
      profile_url: lead.profile_url,
      address: lead.address,
      lat: lead.lat,
      lng: lead.lng,
      categories: lead.categories,
      rating: lead.rating,
      snippet: lead.snippet,
      dedupe_key: dedupeKey,
    });
  }

  async getPeople(ids: string[]): Promise<Person[]> {
    return ids.map((id) => this.people.get(id)).filter((p): p is Person => Boolean(p));
  }

  async optOut(contact: { email?: string; phone?: string }): Promise<number> {
    const email = normEmail(contact.email ?? null);
    const phone = toE164(contact.phone ?? null);
    let n = 0;
    for (const p of this.people.values()) {
      if ((email && p.email === email) || (phone && p.phone === phone)) {
        p.opted_out = true;
        p.regular = false;
        p.sms_consent = false;
        n++;
      }
    }
    return n;
  }

  async setRegular(personId: string, regular: boolean, smsConsent?: boolean): Promise<void> {
    const p = this.people.get(personId);
    if (!p || p.opted_out) return;
    p.regular = regular;
    if (smsConsent !== undefined) p.sms_consent = smsConsent;
  }

  async insertOutreach(row: {
    job_id: string;
    worker_id: string;
    channel: Channel;
    token: string;
    status: OutreachStatus;
  }): Promise<OutreachRow> {
    const dup = this.outreach.find((o) => o.job_id === row.job_id && o.worker_id === row.worker_id);
    if (dup) return dup;
    const saved: OutreachRow = { id: randomUUID(), created_at: new Date().toISOString(), ...row };
    this.outreach.push(saved);
    return saved;
  }

  async listOutreachForJob(jobId: string): Promise<OutreachRow[]> {
    return this.outreach.filter((o) => o.job_id === jobId);
  }

  async touchContacted(personId: string, at: Date): Promise<void> {
    const p = this.people.get(personId);
    if (p) p.last_contacted_at = at.toISOString();
  }

  async recordCost(jobId: string, kind: 'scrape_cost' | 'sms_cost', amountUsd: number, ref: string): Promise<void> {
    if (amountUsd > 0) this.costs.push({ job_id: jobId, kind, amount_usd: amountUsd, ref });
  }
}
