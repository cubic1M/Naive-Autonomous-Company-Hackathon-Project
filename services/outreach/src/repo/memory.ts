import { randomUUID } from 'node:crypto';
import { distanceKm, normEmail, toE164 } from '../geo.js';
import type { Repo } from '../repo.js';
import { mergeProfiles } from '../profiles.js';
import type { Channel, JobForOutreach, Lead, ManualPlatform, ManualTask, ManualTaskStatus, OutreachRow, OutreachStatus, Person } from '../types.js';

function newest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(b).getTime() > new Date(a).getTime() ? b : a;
}

/** In-memory Repo for tests and local dev. Same semantics as PostgresRepo. */
export class InMemoryRepo implements Repo {
  readonly jobs = new Map<string, JobForOutreach>();
  readonly people = new Map<string, Person>();
  readonly outreach: OutreachRow[] = [];
  readonly manual: ManualTask[] = [];
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
      profiles: p.profiles ?? [],
      headline: p.headline ?? null,
      location_text: p.location_text ?? null,
      credentials: p.credentials ?? [],
      open_to_work: p.open_to_work ?? false,
      last_active_at: p.last_active_at ?? null,
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
        profiles: mergeProfiles(existing.profiles, lead.profiles),
        headline: existing.headline ?? lead.headline ?? null,
        location_text: existing.location_text ?? lead.location_text ?? null,
        credentials: [...new Set([...existing.credentials, ...(lead.credentials ?? [])])],
        open_to_work: existing.open_to_work || (lead.open_to_work ?? false),
        last_active_at: newest(existing.last_active_at, lead.last_active_at ?? null),
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
      profiles: lead.profiles ?? [],
      headline: lead.headline ?? null,
      location_text: lead.location_text ?? null,
      credentials: lead.credentials ?? [],
      open_to_work: lead.open_to_work ?? false,
      last_active_at: lead.last_active_at ?? null,
    });
  }

  async getPeople(ids: string[]): Promise<Person[]> {
    return ids.map((id) => this.people.get(id)).filter((p): p is Person => Boolean(p));
  }

  async getByDedupeKeys(keys: string[]): Promise<Person[]> {
    const set = new Set(keys);
    return [...this.people.values()].filter((p) => set.has(p.dedupe_key));
  }

  async findByContact(contact: { email?: string; phone?: string }): Promise<Person[]> {
    const email = normEmail(contact.email ?? null);
    const phone = toE164(contact.phone ?? null);
    if (!email && !phone) return [];
    return [...this.people.values()].filter((p) => (email && p.email === email) || (phone && p.phone === phone));
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

  async getOutreachByToken(token: string): Promise<OutreachRow | null> {
    return this.outreach.find((o) => o.token === token) ?? null;
  }

  async touchContacted(personId: string, at: Date): Promise<void> {
    const p = this.people.get(personId);
    if (p) p.last_contacted_at = at.toISOString();
  }

  async insertManualTask(t: { job_id: string; worker_id: string; platform: ManualPlatform; profile_url: string; message: string }): Promise<ManualTask> {
    const dup = this.manual.find((m) => m.job_id === t.job_id && m.worker_id === t.worker_id && m.platform === t.platform);
    if (dup) return dup;
    const saved: ManualTask = { id: randomUUID(), status: 'queued', created_at: new Date().toISOString(), sent_at: null, ...t };
    this.manual.push(saved);
    return saved;
  }

  async listManualTasks(filter: { job_id?: string; status?: ManualTaskStatus }): Promise<ManualTask[]> {
    return this.manual.filter((m) => (!filter.job_id || m.job_id === filter.job_id) && (!filter.status || m.status === filter.status));
  }

  async markManualTask(id: string, status: 'sent' | 'skipped', at: Date): Promise<void> {
    const m = this.manual.find((x) => x.id === id);
    if (!m) return;
    m.status = status;
    m.sent_at = status === 'sent' ? at.toISOString() : null;
  }

  async countManualTasksSince(platform: ManualPlatform, since: Date): Promise<number> {
    return this.manual.filter((m) => m.platform === platform && new Date(m.created_at).getTime() >= since.getTime()).length;
  }

  async recordCost(jobId: string, kind: 'scrape_cost' | 'sms_cost', amountUsd: number, ref: string): Promise<void> {
    if (amountUsd > 0) this.costs.push({ job_id: jobId, kind, amount_usd: amountUsd, ref });
  }
}
