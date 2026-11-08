import { describe, expect, it } from 'vitest';
import { completenessCheck, loadExif } from '../src/proof/checks.js';
import { PostgresRepo, type SqlClient } from '../src/repo/postgres.js';
import { makeJob } from './helpers.js';

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
      certification_required: null,
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
    expect(job).toMatchObject({ task_type: 'notarization', certification_required: 'CA notary public', budget_cents: 10000, fee_cents: 2500, worker_pay_cents: 7500, proof_schema: { photos: { min: 0, must_show: [] } } });
  });

  it('keeps whether the proof requirement asked for photos: video or files only is not a photo proof', async () => {
    const requested = async (proof_requirement: unknown) => {
      const sql = fakeSql([{ match: 'from jobs', rows: [{ id: JOB, title: 't', lat: 1, lng: 2, deadline: new Date(), budget_usd: '30', proof_requirement, status: 'held' }] }]);
      return (await new PostgresRepo(sql).getJob(JOB))?.proof_schema.photos.requested;
    };
    expect(await requested({ video: { min_seconds: 10 } })).toBe(false);
    expect(await requested({ files: { kinds: ['pdf'] } })).toBe(false);
    expect(await requested({ photos: { min: 0, must_show: [] }, video: { min_seconds: 5 } })).toBe(true);
    expect(await requested({ photos: { min: 1, must_show: ['door'] } })).toBe(true);
    expect(await requested({})).toBe(true);
  });

  it('keeps a remote job NULL location as null, not (0, 0)', async () => {
    const sql = fakeSql([{ match: 'from jobs', rows: [{ id: JOB, title: 'Remote', lat: null, lng: null, deadline: new Date(), budget_usd: '30', proof_requirement: {}, status: 'accepted' }] }]);
    expect(await new PostgresRepo(sql).getJob(JOB)).toMatchObject({ lat: null, lng: null });
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

  it("maps the API proof route's media rows {url, kind: <MIME type>, name}, Blob URL or extension-less /v1/files/<uuid>", async () => {
    // apps/api/src/app/v1/worker/jobs/[token]/proof/route.ts stores kind = File.type ('application/octet-stream' when the
    // browser sent none); without BLOB_READ_WRITE_TOKEN the url is <api>/v1/files/<uuid>, with no extension.
    const blob = 'https://abc123.public.blob.vercel-storage.com/proofs/job-1/1762560000000-IMG_0042-Xy12AbCd.jpg';
    const files = 'https://api.operis.live/v1/files/9b2f6c1e-3d4a-4f5b-8c6d-7e8f9a0b1c2d';
    const media = [
      { url: blob, kind: 'image/jpeg', name: 'IMG_0042.jpg' },
      { url: files, kind: 'image/jpeg', name: 'IMG_0043.jpg' },
      { url: files, kind: 'image/heic', name: 'IMG_0044.HEIC' },
      { url: files, kind: 'video/quicktime', name: 'clip.MOV' },
      { url: files, kind: 'application/pdf', name: 'receipt.pdf' },
      { url: files, kind: 'application/octet-stream', name: 'IMG_0045.JPG' },
      { url: files, kind: 'application/octet-stream', name: 'notes' },
    ];
    const sql = fakeSql([
      { match: 'from proofs where id', rows: [{ id: 'p2', job_id: JOB, worker_id: 'w1', media, fields: {}, gps_lat: null, gps_lng: null, captured_at: null }] },
    ]);
    const proof = await new PostgresRepo(sql).getProof('p2');
    if (!proof) throw new Error('proof not mapped');
    expect(proof.media.map((m) => m.mime)).toEqual([
      'image/jpeg',
      'image/jpeg',
      'image/heic',
      'video/quicktime',
      'application/pdf',
      'image/jpeg',
      'application/octet-stream',
    ]);
    // The readers that key off the MIME prefix now see the four images: completeness counts them, EXIF is read for each.
    expect(completenessCheck(makeJob({ proof_schema: { photos: { min: 4, must_show: [] } } }), proof)).toMatchObject({ status: 'pass', detail: '4 image(s), required fields present' });
    expect((await loadExif({ repo: new PostgresRepo(sql) }, proof)).map((e) => e.media.url)).toEqual([blob, files, files, files]);
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

const CUSTOMER = '00000000-0000-4000-8000-0000000000c1';

describe('PostgresRepo: customers (card on file, migration 0002)', () => {
  it('finds the card on file of the customer who requested the job through jobs.customer_id', async () => {
    const sql = fakeSql([{ match: 'join customers', rows: [{ id: CUSTOMER, name: 'Acme Agent', contact_email: null, stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_1' }] }]);
    const c = await new PostgresRepo(sql).getCustomerPaymentForJob(JOB);
    expect(c).toEqual({ customer_id: CUSTOMER, name: 'Acme Agent', email: null, stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_1' });
    expect(sql.calls[0]?.text).toMatch(/select c\.\* from jobs j join customers c on c\.id = j\.customer_id where j\.id = \$1/);
    expect(sql.calls[0]?.params).toEqual([JOB]);
    expect(await new PostgresRepo(fakeSql([])).getCustomerPaymentForJob(JOB)).toBeNull();
  });

  it('reads customers with select *, so a row from before the migration means no card on file', async () => {
    const sql = fakeSql([{ match: 'from customers', rows: [{ id: CUSTOMER, name: 'Acme Agent', contact_email: 'ops@acme.test', api_key_hash: 'h' }] }]);
    const c = await new PostgresRepo(sql).getCustomerPayment(CUSTOMER);
    expect(c).toEqual({ customer_id: CUSTOMER, name: 'Acme Agent', email: 'ops@acme.test', stripe_customer_id: null, default_payment_method_id: null });
    expect(sql.calls[0]?.text).toMatch(/select \* from customers where id = \$1/);
    expect(sql.calls[0]?.params).toEqual([CUSTOMER]);
    expect(await new PostgresRepo(fakeSql([])).getCustomerPayment(CUSTOMER)).toBeNull();
  });

  it('maps the stored Stripe customer and default payment method', async () => {
    const sql = fakeSql([{ match: 'from customers', rows: [{ id: CUSTOMER, name: null, contact_email: null, stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_1' }] }]);
    expect(await new PostgresRepo(sql).getCustomerPayment(CUSTOMER)).toEqual({
      customer_id: CUSTOMER, name: null, email: null, stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_1',
    });
  });

  it('setCustomerPayment updates only the given columns (coalesce keeps the others)', async () => {
    const sql = fakeSql([]);
    await new PostgresRepo(sql).setCustomerPayment(CUSTOMER, { default_payment_method_id: 'pm_1' });
    const call = sql.calls[0];
    expect(call?.text).toMatch(/update customers set/);
    expect(call?.text).toContain('coalesce($2, stripe_customer_id)');
    expect(call?.text).toContain('coalesce($3, default_payment_method_id)');
    expect(call?.params).toEqual([CUSTOMER, null, 'pm_1']);
  });
});
