import type postgres from 'postgres';
import { normEmail, toE164 } from '../geo.js';
import { cityOf, poolTerms, type PoolQuery, type Repo } from '../repo.js';
import { mergeProfiles } from '../profiles.js';
import type { Channel, JobForOutreach, Lead, ManualPlatform, ManualTask, ManualTaskStatus, OutreachRow, OutreachStatus, Person } from '../types.js';

type Sql = postgres.Sql;
type Row = Record<string, any>;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

const PERSON_COLS = `w.id, w.name, w.email, w.phone, w.source, coalesce(w.opted_out, false) as opted_out,
  p.kind, p.website, p.profile_url, p.address, p.lat, p.lng, p.categories, p.rating, p.snippet,
  p.regular, p.sms_consent, p.last_contacted_at, p.dedupe_key,
  p.profiles, p.headline, p.location_text, p.credentials, p.open_to_work, p.last_active_at`;

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
    profiles: Array.isArray(r.profiles) ? r.profiles : [],
    headline: r.headline ?? null,
    location_text: r.location_text ?? null,
    credentials: Array.isArray(r.credentials) ? r.credentials : [],
    open_to_work: Boolean(r.open_to_work),
    last_active_at: iso(r.last_active_at),
  };
}

function toManual(r: Row): ManualTask {
  return {
    id: r.id,
    job_id: r.job_id,
    worker_id: r.worker_id,
    platform: r.platform,
    profile_url: r.profile_url,
    message: r.message,
    status: r.status,
    created_at: iso(r.created_at)!,
    sent_at: iso(r.sent_at),
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
      select id, title, instructions, address, lat, lng, deadline, budget_usd, worker_pay_usd, certification_required, remote, status
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
      remote: Boolean(r.remote),
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

  async searchPool(q: PoolQuery): Promise<Person[]> {
    const terms = poolTerms(q).map((t) => t.replace(/[%_\\]/g, ' ').trim()).filter(Boolean);
    if (terms.length === 0) return [];
    const radius = q.radiusKm ?? 25;
    const city = cityOf(q.locationText);
    const cityPat = city ? `%${city.replace(/[%_\\]/g, ' ')}%` : null;
    const lat = q.lat ?? null;
    const lng = q.lng ?? null;
    const rows = await this.sql<Row[]>`
      select * from (
        select ${this.sql.unsafe(PERSON_COLS)},
          (select count(*) from unnest(${terms}::text[]) as t(term) where hay.txt like '%' || t.term || '%')::int as hits,
          case when ${lat}::float8 is not null and ${lng}::float8 is not null and p.lat is not null and p.lng is not null then
            2 * 6371 * asin(least(1, sqrt(
              power(sin(radians(p.lat - ${lat}::float8) / 2), 2) +
              cos(radians(${lat}::float8)) * cos(radians(p.lat)) * power(sin(radians(p.lng - ${lng}::float8) / 2), 2)
            ))) end as dist_km,
          p.lat is not null and p.lng is not null as has_coords,
          lower(coalesce(p.location_text, '') || ' ' || coalesce(p.address, '')) as loc,
          coalesce(p.last_active_at, p.updated_at) as recent
        from worker_profiles p
        join workers w on w.id = p.worker_id
        cross join lateral (select lower(concat_ws(' ', w.name, p.headline, p.snippet, p.categories::text, p.credentials::text)) as txt) hay
        where not coalesce(w.opted_out, false)
          and (w.email is not null or (p.regular and p.sms_consent and w.phone is not null))
      ) t
      where hits > 0
        and (${q.remote}::boolean
          or (dist_km is not null and dist_km <= ${radius}::float8)
          or (dist_km is null and not has_coords and ${cityPat}::text is not null and loc like ${cityPat}::text))
      order by hits desc, open_to_work desc, recent desc nulls last
      limit ${q.limit}`;
    return rows.map(toPerson);
  }

  async upsertLead(lead: Lead, dedupeKey: string): Promise<Person> {
    const email = normEmail(lead.email);
    const phone = toE164(lead.phone);
    return this.sql.begin(async (tx) => {
      const existing = await tx<Row[]>`
        select worker_id, profiles, credentials, last_active_at from worker_profiles where dedupe_key = ${dedupeKey} for update`;
      let workerId: string;
      if (existing[0]) {
        workerId = existing[0].worker_id;
        const profiles = mergeProfiles(Array.isArray(existing[0].profiles) ? existing[0].profiles : [], lead.profiles);
        const credentials = [...new Set([...(Array.isArray(existing[0].credentials) ? existing[0].credentials : []), ...(lead.credentials ?? [])])];
        const lastActive = lead.last_active_at ?? null;
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
            profiles = ${tx.json(profiles as any)}::jsonb,
            headline = coalesce(headline, ${lead.headline ?? null}),
            location_text = coalesce(location_text, ${lead.location_text ?? null}),
            credentials = ${tx.json(credentials)}::jsonb,
            open_to_work = open_to_work or ${lead.open_to_work ?? false},
            last_active_at = greatest(last_active_at, ${lastActive}::timestamptz),
            updated_at = now()
          where worker_id = ${workerId}`;
      } else {
        const w = await tx<Row[]>`
          insert into workers (name, email, phone, source)
          values (${lead.name}, ${email}, ${phone}, ${lead.source}) returning id`;
        workerId = w[0]!.id;
        await tx`
          insert into worker_profiles (worker_id, dedupe_key, kind, website, profile_url, address, lat, lng, categories, rating, snippet, source_ref,
                                     profiles, headline, location_text, credentials, open_to_work, last_active_at)
          values (${workerId}, ${dedupeKey}, ${lead.kind}, ${lead.website}, ${lead.profile_url}, ${lead.address}, ${lead.lat}, ${lead.lng},
                  ${tx.json(lead.categories)}, ${lead.rating}, ${lead.snippet}, ${lead.source_ref},
                  ${tx.json(mergeProfiles(lead.profiles, []) as any)}::jsonb, ${lead.headline ?? null}, ${lead.location_text ?? null},
                  ${tx.json([...new Set(lead.credentials ?? [])])}::jsonb, ${lead.open_to_work ?? false}, ${lead.last_active_at ?? null}::timestamptz)`;
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

  async getOutreachByToken(token: string): Promise<OutreachRow | null> {
    const rows = await this.sql<Row[]>`select * from outreach where token = ${token} limit 1`;
    return rows[0] ? toOutreach(rows[0]) : null;
  }

    async touchContacted(personId: string, at: Date): Promise<void> {
    await this.sql`update worker_profiles set last_contacted_at = ${at}, updated_at = now() where worker_id = ${personId}`;
  }

  async insertManualTask(t: { job_id: string; worker_id: string; platform: ManualPlatform; profile_url: string; message: string }): Promise<ManualTask> {
    await this.sql`
      insert into manual_outreach (job_id, worker_id, platform, profile_url, message)
      values (${t.job_id}, ${t.worker_id}, ${t.platform}, ${t.profile_url}, ${t.message})
      on conflict (job_id, worker_id, platform) do nothing`;
    const rows = await this.sql<Row[]>`
      select * from manual_outreach where job_id = ${t.job_id} and worker_id = ${t.worker_id} and platform = ${t.platform}`;
    return toManual(rows[0]!);
  }

  async listManualTasks(filter: { job_id?: string; status?: ManualTaskStatus }): Promise<ManualTask[]> {
    const rows = await this.sql<Row[]>`
      select * from manual_outreach
      where (${filter.job_id ?? null}::uuid is null or job_id = ${filter.job_id ?? null})
        and (${filter.status ?? null}::text is null or status = ${filter.status ?? null})
      order by created_at, id`;
    return rows.map(toManual);
  }

  async markManualTask(id: string, status: 'sent' | 'skipped', at: Date): Promise<void> {
    await this.sql`update manual_outreach set status = ${status}, sent_at = ${status === 'sent' ? at : null} where id = ${id}`;
  }

  async countManualTasksSince(platform: ManualPlatform, since: Date): Promise<number> {
    const rows = await this.sql<Row[]>`select count(*)::int as n from manual_outreach where platform = ${platform} and created_at >= ${since}`;
    return Number(rows[0]?.n ?? 0);
  }

  async recordCost(jobId: string, kind: 'scrape_cost' | 'sms_cost', amountUsd: number, ref: string): Promise<void> {
    if (!(amountUsd > 0)) return;
    await this.sql`insert into ledger (job_id, kind, amount_usd, ref) values (${jobId}, ${kind}, ${amountUsd}, ${ref})`;
  }
}
