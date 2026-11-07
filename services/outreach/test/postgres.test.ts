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
});
