import { describe, expect, it } from 'vitest';
import { PostgresRepo, type SqlClient } from '../src/repo/postgres.js';

/** Scripted SQL client: answers each query by matching a substring of its text; records every call. */
function fakeSql(answers: Array<{ match: string; rows: Record<string, unknown>[] }>): SqlClient & { calls: { text: string; params: unknown[] }[] } {
  const calls: { text: string; params: unknown[] }[] = [];
  return {
    calls,
    async query<R extends Record<string, unknown>>(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      const hit = answers.find((a) => text.includes(a.match));
      return { rows: (hit?.rows ?? []) as R[] };
    },
  };
}

const JOB = '00000000-0000-4000-8000-000000000001';

describe('PostgresRepo against contracts/schema.sql shaped rows', () => {
  it('maps a jobs row with *_usd money and proof_requirement into cents and ProofSchema', async () => {
    const sql = fakeSql([
      {
        match: 'from jobs',
        rows: [
          {
            id: JOB,
            title: 'Photograph the YC sign',
            instructions: 'Two photos',
            lat: 37.7749,
            lng: -122.4194,
            deadline: new Date('2026-11-08T18:00:00-08:00'),
            budget_usd: '60',
            fee_usd: null,
            worker_pay_usd: null,
            certification_required: null,
            proof_requirement: { photos: { min: 2, must_show: ['YC sign'] }, geofence_m: 150 },
            status: 'proof_submitted',
            worker_id: null,
          },
        ],
      },
    ]);
    const job = await new PostgresRepo(sql).getJob(JOB);
    expect(job).toMatchObject({
      id: JOB,
      task_type: 'Photograph the YC sign',
      budget_cents: 6000,
      fee_cents: 1500,
      worker_pay_cents: 4500,
      accepted_at: null,
      proof_schema: { photos: { min: 2, must_show: ['YC sign'] }, geofence_m: 150 },
      required_tier: 0,
      status: 'proof_submitted',
    });
  });

  it('prefers explicit fee/worker columns, and maps a notary certification to task_type notarization', async () => {
    const sql = fakeSql([
      {
        match: 'from jobs',
        rows: [{ id: JOB, title: 'Notarize a deed', lat: 0, lng: 0, deadline: new Date(), budget_usd: '100', fee_usd: '25', worker_pay_usd: '75', certification_required: 'CA notary public', proof_requirement: {}, status: 'held' }],
      },
    ]);
    const job = await new PostgresRepo(sql).getJob(JOB);
    expect(job).toMatchObject({ task_type: 'notarization', budget_cents: 10000, fee_cents: 2500, worker_pay_cents: 7500, proof_schema: { photos: { min: 0, must_show: [] } } });
  });

  it('maps contract media rows {url, kind, exif} to ProofMedia and skips hashless reuse lookups', async () => {
    const sql = fakeSql([
      {
        match: 'from proofs where id',
        rows: [{ id: 'p1', job_id: JOB, worker_id: 'w1', media: [{ url: 'https://blob.test/a.jpg', kind: 'photo', exif: {} }, { url: 'https://blob.test/b.MOV', kind: 'video' }], fields: null, gps_lat: 1, gps_lng: 2, captured_at: null }],
      },
    ]);
    const repo = new PostgresRepo(sql);
    const proof = await repo.getProof('p1');
    expect(proof?.media).toEqual([
      { url: 'https://blob.test/a.jpg', sha256: '', mime: 'image/jpeg' },
      { url: 'https://blob.test/b.MOV', sha256: '', mime: 'video/mp4' },
    ]);
    expect(proof?.fields).toEqual({});
    expect(await repo.findProofsByMediaSha256('')).toEqual([]);
    expect(sql.calls.filter((c) => c.text.includes('jsonb_array_elements'))).toHaveLength(0);
  });

  it('writes amount_usd alongside amount_cents and reads rows other packages wrote in USD', async () => {
    const sql = fakeSql([
      { match: 'insert into ledger', rows: [{ id: 'l1', job_id: JOB, kind: 'fee', amount_cents: 1500, amount_usd: '15', currency: 'usd', stripe_ref: null, idempotency_key: 'fee:x', created_at: new Date() }] },
      { match: 'select * from ledger', rows: [{ id: 'l2', job_id: JOB, kind: 'sms_cost', amount_cents: null, amount_usd: '0.02', ref: 'mobilerun:123', idempotency_key: null, created_at: new Date() }] },
    ]);
    const repo = new PostgresRepo(sql);
    const { inserted, entry } = await repo.insertLedger({ job_id: JOB, kind: 'fee', amount_cents: 1500, stripe_ref: null, idempotency_key: 'fee:x' });
    expect(inserted).toBe(true);
    expect(entry.amount_cents).toBe(1500);
    const insert = sql.calls.find((c) => c.text.includes('insert into ledger'));
    expect(insert?.text).toContain('amount_usd');
    expect(insert?.text).toContain('/ 100.0');
    const rows = await repo.listLedger({});
    expect(rows[0]).toMatchObject({ kind: 'sms_cost', amount_cents: 2, stripe_ref: 'mobilerun:123', idempotency_key: '' });
  });

  it('round-trips notary expiry as a calendar day regardless of server time zone', async () => {
    const localMidnight = new Date(2028, 2, 15); // what pg hands back for a `date` column: local midnight
    const sql = fakeSql([{ match: 'from notary_registry where commission_number', rows: [{ commission_number: '123', full_name: 'JANE SMITH', name_normalized: 'jane smith', commission_expires: localMidnight, raw: {} }] }]);
    const repo = new PostgresRepo(sql);
    const n = await repo.getNotary('123');
    expect(n?.commission_expires?.toISOString()).toBe('2028-03-15T00:00:00.000Z');
    await repo.upsertNotary({ commission_number: '123', full_name: 'JANE SMITH', name_normalized: 'jane smith', county: null, city: null, business_name: null, commission_expires: new Date('2028-03-15T00:00:00Z'), raw: {} });
    const upsert = sql.calls.find((c) => c.text.includes('insert into notary_registry'));
    expect(upsert?.params[6]).toBe('2028-03-15');
  });
});
