import { GrowthTablesMissing, REDDIT_REF, redditLogEntry, type GrowthRepo } from '../repo.js';
import type { Contact, ContactKind, Grant, JobRow, JobWithCustomer, LogEntry, MessageKind, NewContact, RedditCall, VerificationRow } from '../types.js';
import type { NewSocialPost, SocialPlatform, SocialPost, SocialPostOutcome } from '../types.js';

/** Anything with query(text, params) → { rows }: PGlite, @neondatabase/serverless, or postgres.js through dbFromPostgresJs. */
export interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/** apps/api's postgres.js `sql` as a Db (its unsafe(text, params) takes $1-style parameters). */
export function dbFromPostgresJs(sql: { unsafe(text: string, params?: any[]): PromiseLike<unknown> }): Db {
  return { query: async (text, params) => ({ rows: Array.from((await sql.unsafe(text, (params ?? []) as any[])) as Iterable<any>) }) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));
const missingTable = (e: unknown) => (e as { code?: string } | null)?.code === '42P01';
const lower = (email: string) => email.trim().toLowerCase();

function contact(r: any): Contact {
  return {
    id: String(r.id),
    kind: r.kind,
    email: r.email,
    name: r.name ?? null,
    org: r.org ?? null,
    family: r.family ?? null,
    worker_id: r.worker_id ?? null,
    found_via: r.found_via,
    notes: r.notes ?? null,
    free_first_job: Boolean(r.free_first_job),
    opted_out: Boolean(r.opted_out),
    joined_at: date(r.joined_at),
    last_contacted_at: date(r.last_contacted_at),
    created_at: date(r.created_at)!,
  };
}

function grant(r: any): Grant {
  return {
    id: String(r.id),
    contact_id: String(r.contact_id),
    grant_key: r.grant_key,
    cap_cents: Number(r.cap_cents),
    expires_at: date(r.expires_at)!,
    redeemed_job_id: r.redeemed_job_id ?? null,
    refund_cents: r.refund_cents === null || r.refund_cents === undefined ? null : Number(r.refund_cents),
    redeemed_at: date(r.redeemed_at),
    created_at: date(r.created_at)!,
  };
}

function socialPost(r: any): SocialPost {
  return {
    id: String(r.id),
    platform: r.platform,
    status: r.status,
    reason: r.reason ?? null,
    body: r.body,
    body_hash: r.body_hash,
    provider: r.provider ?? null,
    provider_post_id: r.provider_post_id ?? null,
    url: r.url ?? null,
    created_at: date(r.created_at)!,
  };
}

function withCustomer(r: any): JobWithCustomer {
  return {
    job_id: String(r.job_id),
    customer_id: r.customer_id ?? null,
    customer_name: r.customer_name ?? null,
    contact_email: r.contact_email ?? null,
    budget_usd: Number(r.budget_usd),
    status: r.status,
    created_at: date(r.created_at)!,
  };
}

const JOB_WITH_CUSTOMER = `select j.id as job_id, j.customer_id, c.name as customer_name, lower(c.contact_email) as contact_email,
  j.budget_usd::float8 as budget_usd, j.status, j.created_at from jobs j left join customers c on c.id = j.customer_id`;

/** GrowthRepo on Postgres (Neon in production): plain SQL with $n parameters over migrations/0001_growth.sql. */
export class PostgresGrowthRepo implements GrowthRepo {
  constructor(private readonly db: Db) {}

  private async q(text: string, params: unknown[] = []): Promise<any[]> {
    try {
      return (await this.db.query(text, params)).rows;
    } catch (e) {
      const message = String((e as Error).message);
      if (missingTable(e) && /growth_/.test(message)) throw new GrowthTablesMissing(/growth_social_posts/.test(message) ? '0002_social.sql' : undefined);
      throw e;
    }
  }

  async upsertContact(c: NewContact): Promise<{ contact: Contact; created: boolean }> {
    const rows = await this.q(
      `insert into growth_contacts (kind, email, name, org, family, worker_id, found_via, notes, free_first_job, opted_out, opted_out_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               exists (select 1 from growth_contacts s where s.email = $2 and s.opted_out),
               (select min(s.opted_out_at) from growth_contacts s where s.email = $2 and s.opted_out))
       on conflict (kind, email) do update set
         name = coalesce(growth_contacts.name, excluded.name),
         org = coalesce(growth_contacts.org, excluded.org),
         family = coalesce(growth_contacts.family, excluded.family),
         worker_id = coalesce(growth_contacts.worker_id, excluded.worker_id),
         notes = coalesce(excluded.notes, growth_contacts.notes),
         free_first_job = growth_contacts.free_first_job or excluded.free_first_job
       returning *, (xmax = 0) as created`,
      [c.kind, lower(c.email), c.name ?? null, c.org ?? null, c.family ?? null, c.worker_id ?? null, c.found_via, c.notes ?? null, Boolean(c.free_first_job)],
    );
    return { contact: contact(rows[0]), created: Boolean(rows[0].created) };
  }

  async getContact(id: string): Promise<Contact | null> {
    if (!UUID.test(id)) return null;
    const rows = await this.q('select * from growth_contacts where id = $1', [id]);
    return rows[0] ? contact(rows[0]) : null;
  }

  async getRecruitByWorker(workerId: string): Promise<Contact | null> {
    if (!UUID.test(workerId)) return null;
    const rows = await this.q(`select * from growth_contacts where kind = 'recruit' and worker_id = $1 order by created_at limit 1`, [workerId]);
    return rows[0] ? contact(rows[0]) : null;
  }

  async listProspects(q: { limit: number; notSentSince: Date }): Promise<Contact[]> {
    const rows = await this.q(
      `select * from growth_contacts where kind = 'prospect' and not opted_out
         and (last_contacted_at is null or last_contacted_at < $2) order by created_at, id limit $1`,
      [q.limit, q.notSentSince],
    );
    return rows.map(contact);
  }

  async listRecruits(): Promise<Contact[]> {
    return (await this.q(`select * from growth_contacts where kind = 'recruit' order by created_at`)).map(contact);
  }

  async markContacted(id: string, at: Date): Promise<void> {
    await this.q('update growth_contacts set last_contacted_at = $2 where id = $1', [id, at]);
  }

  async markJoined(id: string, at: Date): Promise<void> {
    await this.q('update growth_contacts set joined_at = coalesce(joined_at, $2) where id = $1', [id, at]);
  }

  async optOutEmail(email: string, at: Date): Promise<number> {
    const e = lower(email);
    const rows = await this.q('update growth_contacts set opted_out = true, opted_out_at = coalesce(opted_out_at, $2) where email = $1 returning id', [e, at]);
    if (rows.length === 0) {
      await this.q(
        `insert into growth_contacts (kind, email, found_via, opted_out, opted_out_at) values ('prospect', $1, 'suppressed: asked us to stop', true, $2)
         on conflict (kind, email) do update set opted_out = true, opted_out_at = coalesce(growth_contacts.opted_out_at, excluded.opted_out_at)`,
        [e, at],
      );
    }
    return rows.length;
  }

  async isSuppressed(email: string): Promise<boolean> {
    return (await this.q('select 1 from growth_contacts where email = $1 and opted_out limit 1', [lower(email)])).length > 0;
  }

  async lastSentAt(email: string, kind: ContactKind): Promise<Date | null> {
    const rows = await this.q('select max(last_contacted_at) as at from growth_contacts where email = $1 and kind = $2', [lower(email), kind]);
    return date(rows[0]?.at);
  }

  async log(e: LogEntry): Promise<void> {
    await this.q('insert into growth_log (contact_id, kind, status, reason, family, cost_usd, ref) values ($1, $2, $3, $4, $5, $6, $7)', [
      e.contact_id ?? null,
      e.kind,
      e.status,
      e.reason ?? null,
      e.family ?? null,
      e.cost_usd ?? 0,
      e.ref ?? null,
    ]);
  }

  async messageCountsSince(kind: MessageKind, since: Date): Promise<{ sent: number; dry_run: number }> {
    const rows = await this.q(
      `select status, count(*)::int as n from growth_log where kind = $1 and created_at >= $2 and status in ('sent', 'dry_run') group by status`,
      [kind, since],
    );
    const n = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
    return { sent: n('sent'), dry_run: n('dry_run') };
  }

  async searchSpendSince(since: Date): Promise<number> {
    const rows = await this.q(
      `select coalesce(sum(cost_usd), 0)::float8 as usd from growth_log where kind = 'search' and ref is distinct from $2 and created_at >= $1`,
      [since, REDDIT_REF],
    );
    return Number(rows[0]?.usd ?? 0);
  }

  async logRedditCall(c: RedditCall): Promise<void> {
    await this.log(redditLogEntry(c));
  }

  async redditSpendSince(since: Date): Promise<number> {
    const rows = await this.q(`select coalesce(sum(cost_usd), 0)::float8 as usd from growth_log where kind = 'search' and ref = $2 and created_at >= $1`, [
      since,
      REDDIT_REF,
    ]);
    return Number(rows[0]?.usd ?? 0);
  }

  async getGrantByKey(key: string): Promise<Grant | null> {
    const rows = await this.q('select * from growth_promos where grant_key = $1', [key]);
    return rows[0] ? grant(rows[0]) : null;
  }

  async getGrantByJob(jobId: string): Promise<Grant | null> {
    if (!UUID.test(jobId)) return null;
    const rows = await this.q('select * from growth_promos where redeemed_job_id = $1', [jobId]);
    return rows[0] ? grant(rows[0]) : null;
  }

  async countGrants(): Promise<number> {
    return Number((await this.q('select count(*)::int as n from growth_promos'))[0]?.n ?? 0);
  }

  async listGrants(): Promise<Grant[]> {
    return (await this.q('select * from growth_promos order by created_at')).map(grant);
  }

  async insertGrant(g: { contact_id: string; grant_key: string; cap_cents: number; expires_at: Date }): Promise<Grant | null> {
    const rows = await this.q(
      'insert into growth_promos (contact_id, grant_key, cap_cents, expires_at) values ($1, $2, $3, $4) on conflict (grant_key) do nothing returning *',
      [g.contact_id, g.grant_key, g.cap_cents, g.expires_at],
    );
    return rows[0] ? grant(rows[0]) : null;
  }

  async reserveGrant(grantId: string, jobId: string, refundCents: number, at: Date): Promise<Grant | null> {
    const rows = await this.q(
      'update growth_promos set redeemed_job_id = $2, refund_cents = $3, redeemed_at = $4 where id = $1 and redeemed_job_id is null returning *',
      [grantId, jobId, refundCents, at],
    );
    if (rows[0]) return grant(rows[0]);
    const current = await this.q('select * from growth_promos where id = $1', [grantId]);
    return current[0] ? grant(current[0]) : null;
  }

  async listJobsSince(since: Date): Promise<JobRow[]> {
    // jobs.remote comes from services/outreach's 0002 migration; to_jsonb keeps this working without the column.
    const rows = await this.q(
      `select id, title, instructions, certification_required, lat, lng,
              coalesce((to_jsonb(j) ->> 'remote')::boolean, false) as remote, status, worker_id, created_at, updated_at
       from jobs j where created_at >= $1`,
      [since],
    );
    return rows.map((r) => ({
      id: String(r.id),
      title: r.title,
      instructions: r.instructions,
      certification_required: r.certification_required ?? null,
      lat: r.lat === null ? null : Number(r.lat),
      lng: r.lng === null ? null : Number(r.lng),
      remote: Boolean(r.remote),
      status: r.status,
      worker_id: r.worker_id ?? null,
      created_at: date(r.created_at)!,
      updated_at: date(r.updated_at) ?? date(r.created_at)!,
    }));
  }

  async listPaidJobs(): Promise<JobWithCustomer[]> {
    return (await this.q(`${JOB_WITH_CUSTOMER} where j.status = 'paid'`)).map(withCustomer);
  }

  async getJobWithCustomer(jobId: string): Promise<JobWithCustomer | null> {
    if (!UUID.test(jobId)) return null;
    const rows = await this.q(`${JOB_WITH_CUSTOMER} where j.id = $1`, [jobId]);
    return rows[0] ? withCustomer(rows[0]) : null;
  }

  async countPaidJobsBefore(customerId: string, before: Date, excludeJobId: string): Promise<number> {
    const rows = await this.q(`select count(*)::int as n from jobs where customer_id = $1 and status = 'paid' and created_at < $2 and id <> $3`, [
      customerId,
      before,
      excludeJobId,
    ]);
    return Number(rows[0]?.n ?? 0);
  }

  async listVerifications(workerIds: string[]): Promise<VerificationRow[]> {
    const ids = [...new Set(workerIds)].filter((id) => UUID.test(id));
    if (ids.length === 0) return [];
    try {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await this.db.query(`select worker_id, kind, status from worker_verifications where worker_id in (${placeholders})`, ids);
      return rows.map((r) => ({ worker_id: String(r.worker_id), kind: r.kind, status: r.status }));
    } catch (e) {
      if (missingTable(e)) return []; // Cameron's migration has not run yet
      throw e;
    }
  }

  async logSocialPost(p: NewSocialPost): Promise<string> {
    const rows = await this.q('insert into growth_social_posts (platform, status, reason, body, body_hash) values ($1, $2, $3, $4, $5) returning id', [
      p.platform,
      p.status,
      p.reason ?? null,
      p.body,
      p.body_hash,
    ]);
    return String(rows[0].id);
  }

  async settleSocialPost(id: string, o: SocialPostOutcome): Promise<void> {
    if (!UUID.test(id)) return;
    await this.q(
      `update growth_social_posts set status = $2, reason = $3, provider = $4, provider_post_id = $5, url = $6 where id = $1 and status = 'pending'`,
      [id, o.status, o.reason ?? null, o.provider ?? null, o.provider_post_id ?? null, o.url ?? null],
    );
  }

  async socialPostsSince(platform: SocialPlatform, since: Date): Promise<SocialPost[]> {
    const rows = await this.q('select * from growth_social_posts where platform = $1 and created_at >= $2 order by created_at desc, id', [platform, since]);
    return rows.map(socialPost);
  }
}
