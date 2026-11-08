import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresRepo } from '../src/repo/postgres.js';
import type { Lead } from '../src/types.js';

const url = process.env.TEST_DATABASE_URL;
const schemaName = `outreach_test_${process.pid}`;

const lead = (o: Partial<Lead> = {}): Lead => ({
  name: 'Acme Photo', kind: 'business', email: 'hi@acme.com', phone: null, website: null, profile_url: null,
  address: null, lat: 37.77, lng: -122.42, source: 't', source_ref: 'r1', categories: ['photo'], rating: null, snippet: null, ...o,
});

describe.skipIf(!url)('PostgresRepo', () => {
  let sql: postgres.Sql;
  let repo: PostgresRepo;
  let jobId: string;

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await sql.unsafe(`drop schema if exists ${schemaName} cascade; create schema ${schemaName}; set search_path to ${schemaName}, public`);
    await sql.unsafe(readFileSync(resolve(__dirname, '../../../contracts/schema.sql'), 'utf8'));
    await sql.unsafe(readFileSync(resolve(__dirname, '../migrations/0001_outreach.sql'), 'utf8'));
    await sql.unsafe(readFileSync(resolve(__dirname, '../migrations/0002_people.sql'), 'utf8'));
    await sql.unsafe(readFileSync(resolve(__dirname, '../migrations/0002_people.sql'), 'utf8')); // idempotent
    repo = new PostgresRepo(sql);
    const j = await sql`insert into jobs (title, instructions, budget_usd, proof_requirement, status, lat, lng)
      values ('J', 'do', 40, '{}', 'held', 37.77, -122.42) returning id`;
    jobId = j[0]!.id;
  });
  afterAll(async () => {
    await sql.unsafe(`drop schema if exists ${schemaName} cascade`);
    await sql.end();
  });

  it('reads jobs with numeric conversion', async () => {
    const job = await repo.getJob(jobId);
    expect(job?.budget_usd).toBe(40);
    expect(job?.worker_pay_usd).toBeNull();
    expect(job?.remote).toBe(false);
    expect(await repo.getJob('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('upsertLead merges without clobbering', async () => {
    const p1 = await repo.upsertLead(lead(), 'email:hi@acme.com');
    await repo.setRegular(p1.id, true, true);
    const p2 = await repo.upsertLead(lead({ name: null, email: null, phone: '4155550142', categories: ['video'] }), 'email:hi@acme.com');
    expect(p2.id).toBe(p1.id);
    expect(p2.email).toBe('hi@acme.com');
    expect(p2.phone).toBe('+14155550142');
    expect(p2.name).toBe('Acme Photo');
    expect(p2.regular).toBe(true);
    expect(p2.sms_consent).toBe(true);
    expect([...p2.categories].sort()).toEqual(['photo', 'video']);
  });

  it('listRegularsNear is nearest-first and radius limited', async () => {
    const far = await repo.upsertLead(lead({ email: 'far@x.com', lat: 37.85, lng: -122.42 }), 'email:far@x.com');
    const veryFar = await repo.upsertLead(lead({ email: 'vf@x.com', lat: 40.7, lng: -74 }), 'email:vf@x.com');
    await repo.setRegular(far.id, true);
    await repo.setRegular(veryFar.id, true);
    const near = await repo.listRegularsNear(37.77, -122.42, 20, 10);
    expect(near.map((p) => p.email)).toEqual(['hi@acme.com', 'far@x.com']);
  });

  it('insertOutreach is idempotent; touchContacted and recordCost work', async () => {
    const p = (await repo.getPeople([(await repo.upsertLead(lead(), 'email:hi@acme.com')).id]))[0]!;
    const a = await repo.insertOutreach({ job_id: jobId, worker_id: p.id, channel: 'email', token: 't1', status: 'sent' });
    const b = await repo.insertOutreach({ job_id: jobId, worker_id: p.id, channel: 'email', token: 't2', status: 'sent' });
    expect(b.id).toBe(a.id);
    expect(await repo.listOutreachForJob(jobId)).toHaveLength(1);
    await repo.touchContacted(p.id, new Date());
    expect((await repo.getPeople([p.id]))[0]!.last_contacted_at).not.toBeNull();
    await repo.recordCost(jobId, 'sms_cost', 0.0075, 'ref');
    const rows = await sql`select amount_usd from ledger where job_id = ${jobId}`;
    expect(Number(rows[0]!.amount_usd)).toBeCloseTo(0.0075);
  });

  it('optOut flips flags and never un-sets via upsert', async () => {
    const n = await repo.optOut({ email: 'HI@acme.com' });
    expect(n).toBe(1);
    const p = await repo.upsertLead(lead(), 'email:hi@acme.com');
    expect(p.opted_out).toBe(true);
    expect(p.regular).toBe(false);
    expect((await repo.listRegularsNear(37.77, -122.42, 20, 10)).map((x) => x.email)).toEqual(['far@x.com']);
  });

  it('person fields default, merge profiles/credentials, OR open_to_work, newest last_active, never null-overwrite', async () => {
    const li = { platform: 'linkedin' as const, url: 'https://www.linkedin.com/in/jane', handle: 'jane' };
    const gh = { platform: 'github' as const, url: 'https://github.com/jane', handle: 'jane' };
    const plain = await repo.upsertLead(lead({ email: 'plain@x.com' }), 'email:plain@x.com');
    expect(plain).toMatchObject({ profiles: [], headline: null, location_text: null, credentials: [], open_to_work: false, last_active_at: null });

    const a = await repo.upsertLead(
      lead({ kind: 'person', name: 'Jane', email: null, profiles: [li], headline: 'Attorney', location_text: 'SF', credentials: ['CA Bar'], open_to_work: false, last_active_at: '2026-10-01T00:00:00Z' }),
      'li:jane',
    );
    expect(a.profiles).toEqual([li]);
    expect(a.last_active_at).toBe('2026-10-01T00:00:00.000Z');
    const b = await repo.upsertLead(
      lead({ kind: 'person', name: null, email: null, profiles: [li, gh], headline: 'Other', location_text: null, credentials: ['CA Bar', 'Notary'], open_to_work: true, last_active_at: '2026-09-01T00:00:00Z' }),
      'li:jane',
    );
    expect(b.id).toBe(a.id);
    expect(b.profiles).toEqual([li, gh]);
    expect([...b.credentials].sort()).toEqual(['CA Bar', 'Notary']);
    expect(b.open_to_work).toBe(true);
    expect(b.headline).toBe('Attorney');
    expect(b.location_text).toBe('SF');
    expect(b.last_active_at).toBe('2026-10-01T00:00:00.000Z'); // older one doesn't win
    const c = await repo.upsertLead(lead({ kind: 'person', email: null, open_to_work: false, last_active_at: null }), 'li:jane');
    expect(c.open_to_work).toBe(true);
    expect(c.last_active_at).toBe('2026-10-01T00:00:00.000Z');
    const d = await repo.upsertLead(lead({ kind: 'person', email: null, last_active_at: '2026-11-01T00:00:00Z' }), 'li:jane');
    expect(d.last_active_at).toBe('2026-11-01T00:00:00.000Z');
  });

  it('remote jobs are read as remote', async () => {
    const j = await sql`insert into jobs (title, instructions, budget_usd, proof_requirement, status, remote)
      values ('R', 'do', 40, '{}', 'held', true) returning id`;
    expect((await repo.getJob(j[0]!.id))?.remote).toBe(true);
  });

  it('manual queue: idempotent insert, list filters, mark, count since', async () => {
    const p = await repo.upsertLead(lead({ kind: 'person', email: null }), 'li:jane');
    const q = await repo.upsertLead(lead({ kind: 'person', email: null }), 'x:other');
    const t = { job_id: jobId, worker_id: p.id, platform: 'linkedin' as const, profile_url: 'https://www.linkedin.com/in/jane', message: 'Hi' };
    const t1 = await repo.insertManualTask(t);
    const t1b = await repo.insertManualTask({ ...t, message: 'changed' });
    expect(t1b.id).toBe(t1.id);
    expect(t1b.message).toBe('Hi');
    expect(t1).toMatchObject({ status: 'queued', sent_at: null, platform: 'linkedin', job_id: jobId, worker_id: p.id });
    const t2 = await repo.insertManualTask({ ...t, worker_id: q.id, platform: 'x', profile_url: 'https://x.com/o' });
    // same person, other platform is a separate task
    await repo.insertManualTask({ ...t, platform: 'x', profile_url: 'https://x.com/jane' });

    expect(await repo.listManualTasks({ job_id: jobId })).toHaveLength(3);
    expect(await repo.listManualTasks({ status: 'queued' })).toHaveLength(3);
    expect(await repo.listManualTasks({ job_id: '00000000-0000-0000-0000-000000000000' })).toHaveLength(0);

    const now = new Date();
    expect(await repo.countManualTasksSince('x', new Date(now.getTime() - 3600_000))).toBe(2);
    expect(await repo.countManualTasksSince('linkedin', new Date(now.getTime() + 3600_000))).toBe(0);
    expect(await repo.countManualTasksSince('reddit', new Date(0))).toBe(0);

    await repo.markManualTask(t1.id, 'sent', now);
    await repo.markManualTask(t2.id, 'skipped', now);
    const sent = await repo.listManualTasks({ status: 'sent' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.sent_at).not.toBeNull();
    expect(await repo.listManualTasks({ status: 'queued' })).toHaveLength(1);
  });
});
