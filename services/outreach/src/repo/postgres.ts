import type postgres from 'postgres';
import { normEmail, toE164 } from '../geo.js';
import type { Repo } from '../repo.js';
import type { Channel, JobForOutreach, Lead, OutreachRow, OutreachStatus, Person } from '../types.js';

type Sql = postgres.Sql;
type Row = Record<string, any>;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

const PERSON_COLS = `w.id, w.name, w.email, w.phone, w.source, coalesce(w.opted_out, false) as opted_out,
  p.kind, p.website, p.profile_url, p.address, p.lat, p.lng, p.categories, p.rating, p.snippet,
  p.regular, p.sms_consent, p.last_contacted_at, p.dedupe_key`;

function toPerson(r: Row): Person {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    source: r.source,
    opted_out: r.opted_out,
    kind: r.kind === 'person' ? 'person' : 'business',
    website: r.website,
    profile_url: r.profile_url,
    address: r.address,
    lat: num(r.lat),
    lng: num(r.lng),
    categories: Array.isArray(r.categories) ? r.categories : [],
    rating: num(r.rating),
    snippet: r.snippet,
    regular: r.regular,
    sms_consent: r.sms_consent,
    last_contacted_at: iso(r.last_contacted_at),
    dedupe_key: r.dedupe_key,
  };
}

function toOutreach(r: Row): OutreachRow {
  return {
    id: r.id,
    job_id: r.job_id,
    worker_id: r.worker_id,
    channel: r.channel,
    token: r.token,
    status: r.status,
    created_at: iso(r.created_at)!,
  };
}

export class PostgresRepo implements Repo {
  constructor(private readonly sql: Sql) {}

  async getJob(id: string): Promise<JobForOutreach | null> {
    const rows = await this.sql<Row[]>`
      select id, title, instructions, address, lat, lng, deadline, budget_usd, worker_pay_usd, certification_required, status
      from jobs where id = ${id}`;
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      title: r.title,
      instructions: r.instructions,
      address: r.address,
      lat: num(r.lat),
      lng: num(r.lng),
      deadline: iso(r.deadline),
      budget_usd: Number(r.budget_usd),
      worker_pay_usd: num(r.worker_pay_usd),
      certification_required: r.certification_required,
      status: r.status,
    };
  }

  async listRegularsNear(lat: number, lng: number, radiusKm: number, limit: number): Promise<Person[]> {
    const rows = await this.sql<Row[]>`
      select * from (
        select ${this.sql.unsafe(PERSON_COLS)},
          2 * 6371 * asin(least(1, sqrt(
            power(sin(radians(p.lat - ${lat}) / 2), 2) +
            cos(radians(${lat})) * cos(radians(p.lat)) * power(sin(radians(p.lng - ${lng}) / 2), 2)
          ))) as dist_km
        from worker_profiles p join workers w on w.id = p.worker_id
        where p.regular and not coalesce(w.opted_out, false) and p.lat is not null and p.lng is not null
      ) t
      where dist_km <= ${radiusKm}
      order by dist_km asc
      limit ${limit}`;
    return rows.map(toPerson);
  }

  async upsertLead(lead: Lead, dedupeKey: string): Promise<Person> {
    const email = normEmail(lead.email);
    const phone = toE164(lead.phone);
    return this.sql.begin(async (tx) => {
      const existing = await tx<Row[]>`select worker_id from worker_profiles where dedupe_key = ${dedupeKey} for update`;
      let workerId: string;
      if (existing[0]) {
        workerId = existing[0].worker_id;
        await tx`update workers set
            name = coalesce(name, ${lead.name}),
            email = coalesce(email, ${email}),
            phone = coalesce(phone, ${phone})
          where id = ${workerId}`;
        await tx`update worker_profiles set
            website = coalesce(website, ${lead.website}),
            profile_url = coalesce(profile_url, ${lead.profile_url}),
            address = coalesce(address, ${lead.address}),
            lat = coalesce(lat, ${lead.lat}),
            lng = coalesce(lng, ${lead.lng}),
            categories = (select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
                          from jsonb_array_elements_text(categories || ${tx.json(lead.categories)}::jsonb) as v),
            rating = coalesce(rating, ${lead.rating}),
            snippet = coalesce(snippet, ${lead.snippet}),
            source_ref = coalesce(source_ref, ${lead.source_ref}),
            updated_at = now()
          where worker_id = ${workerId}`;
      } else {
        const w = await tx<Row[]>`
          insert into workers (name, email, phone, source)
          values (${lead.name}, ${email}, ${phone}, ${lead.source}) returning id`;
        workerId = w[0]!.id;
        await tx`
          insert into worker_profiles (worker_id, dedupe_key, kind, website, profile_url, address, lat, lng, categories, rating, snippet, source_ref)
          values (${workerId}, ${dedupeKey}, ${lead.kind}, ${lead.website}, ${lead.profile_url}, ${lead.address}, ${lead.lat}, ${lead.lng},
                  ${tx.json(lead.categories)}, ${lead.rating}, ${lead.snippet}, ${lead.source_ref})`;
      }
      const rows = await tx<Row[]>`
        select ${tx.unsafe(PERSON_COLS)} from workers w join worker_profiles p on p.worker_id = w.id where w.id = ${workerId}`;
      return toPerson(rows[0]!);
    }) as Promise<Person>;
  }

  async getPeople(ids: string[]): Promise<Person[]> {
    if (ids.length === 0) return [];
    const rows = await this.sql<Row[]>`
      select ${this.sql.unsafe(PERSON_COLS)} from workers w join worker_profiles p on p.worker_id = w.id
      where w.id in ${this.sql(ids)}`;
    const byId = new Map(rows.map((r) => [r.id as string, toPerson(r)]));
    return ids.map((id) => byId.get(id)).filter((p): p is Person => Boolean(p));
  }

  async getByDedupeKeys(keys: string[]): Promise<Person[]> {
    if (keys.length === 0) return [];
    const rows = await this.sql<Row[]>`
      select ${this.sql.unsafe(PERSON_COLS)} from workers w join worker_profiles p on p.worker_id = w.id
      where p.dedupe_key in ${this.sql(keys)}`;
    return rows.map(toPerson);
  }

  async findByContact(contact: { email?: string; phone?: string }): Promise<Person[]> {
    const email = normEmail(contact.email ?? null);
    const phone = toE164(contact.phone ?? null);
    if (!email && !phone) return [];
    const rows = await this.sql<Row[]>`
      select ${this.sql.unsafe(PERSON_COLS)} from workers w join worker_profiles p on p.worker_id = w.id
      where (${email}::text is not null and lower(w.email) = ${email})
         or (${phone}::text is not null and w.phone = ${phone})`;
    return rows.map(toPerson);
  }

  async optOut(contact: { email?: string; phone?: string }): Promise<number> {
    const email = normEmail(contact.email ?? null);
    const phone = toE164(contact.phone ?? null);
    if (!email && !phone) return 0;
    return this.sql.begin(async (tx) => {
      const rows = await tx<Row[]>`
        update workers set opted_out = true
        where (${email}::text is not null and lower(email) = ${email})
           or (${phone}::text is not null and phone = ${phone})
        returning id`;
      if (rows.length > 0) {
        await tx`update worker_profiles set regular = false, sms_consent = false, updated_at = now()
                 where worker_id in ${tx(rows.map((r) => r.id as string))}`;
      }
      return rows.length;
    }) as Promise<number>;
  }

  async setRegular(personId: string, regular: boolean, smsConsent?: boolean): Promise<void> {
    await this.sql`
      update worker_profiles p set regular = ${regular},
        sms_consent = coalesce(${smsConsent ?? null}::boolean, p.sms_consent), updated_at = now()
      from workers w
      where w.id = p.worker_id and p.worker_id = ${personId} and not coalesce(w.opted_out, false)`;
  }

  async insertOutreach(row: { job_id: string; worker_id: string; channel: Channel; token: string; status: OutreachStatus }): Promise<OutreachRow> {
    await this.sql`
      insert into outreach (job_id, worker_id, channel, token, status)
      values (${row.job_id}, ${row.worker_id}, ${row.channel}, ${row.token}, ${row.status})
      on conflict (job_id, worker_id) do nothing`;
    const rows = await this.sql<Row[]>`select * from outreach where job_id = ${row.job_id} and worker_id = ${row.worker_id}`;
    return toOutreach(rows[0]!);
  }

  async listOutreachForJob(jobId: string): Promise<OutreachRow[]> {
    const rows = await this.sql<Row[]>`select * from outreach where job_id = ${jobId} order by created_at`;
    return rows.map(toOutreach);
  }

  async touchContacted(personId: string, at: Date): Promise<void> {
    await this.sql`update worker_profiles set last_contacted_at = ${at}, updated_at = now() where worker_id = ${personId}`;
  }

  async recordCost(jobId: string, kind: 'scrape_cost' | 'sms_cost', amountUsd: number, ref: string): Promise<void> {
    if (!(amountUsd > 0)) return;
    await this.sql`insert into ledger (job_id, kind, amount_usd, ref) values (${jobId}, ${kind}, ${amountUsd}, ${ref})`;
  }
}
