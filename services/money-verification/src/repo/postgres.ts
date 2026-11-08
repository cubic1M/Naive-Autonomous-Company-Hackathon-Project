import { FEE_BPS } from '../pricing.js';
import type { Repo, LedgerQuery } from '../repo.js';
import type {
  Dispute,
  Escrow,
  EscrowStatus,
  Job,
  LedgerEntry,
  NewLedgerEntry,
  NotaryRecord,
  Payout,
  PayoutStatus,
  Proof,
  ProofMedia,
  ProofReview,
  ProofSchema,
  VerificationKind,
  Worker,
  WorkerVerification,
} from '../types.js';

/**
 * Minimal SQL client shape. `pg.Pool`, `pg.Client` and `@neondatabase/serverless` `Pool` all satisfy it.
 * All statements are parameterized; no string interpolation of values.
 */
export interface SqlClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
}

type Row = Record<string, unknown>;

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const date = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
const json = <T>(v: unknown, fallback: T): T =>
  v == null ? fallback : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T);
/**
 * `date` columns (no time zone). pg hands them back as LOCAL midnight Dates, so rebuild the calendar day as
 * UTC midnight; a 'YYYY-MM-DD' string (some drivers) is parsed the same way. Keeps comparisons TZ-independent.
 */
const dateOnly = (v: unknown): Date | null => {
  if (v == null) return null;
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : date(v);
};
/** Send a calendar day as 'YYYY-MM-DD': pg would serialise a Date in local time and shift the day west of UTC. */
const isoDay = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

// ---- contracts/schema.sql compatibility ------------------------------------------------------------
// The shared jobs/proofs tables keep money as *_usd numerics, the proof requirement as `proof_requirement`
// and media as [{url, kind, exif}]. This package is integer cents and reads ProofSchema / ProofMedia, so the
// mappers accept both spellings and prefer the cents columns when a later migration adds them.

const usdToCents = (v: unknown): number | null => (v == null ? null : Math.round(num(v) * 100));

/** 25% fee, half-up, with no minimum-price check: mapping a row must never throw on an odd budget. */
function feeSplit(priceCents: number): { fee: number; worker: number } {
  const fee = Math.floor((priceCents * FEE_BPS + 5_000) / 10_000);
  return { fee, worker: priceCents - fee };
}

/** Our checks key off task_type; the contract marks notary work with certification_required. */
function taskTypeOf(r: Row): string {
  if (r.task_type != null) return String(r.task_type);
  const cert = r.certification_required == null ? '' : String(r.certification_required).toLowerCase();
  if (cert.includes('notar')) return 'notarization';
  return r.title == null ? 'job' : String(r.title);
}

function proofSchemaOf(r: Row): ProofSchema {
  const p = json<{ photos?: { min?: unknown; must_show?: unknown }; geofence_m?: unknown; fields?: unknown }>(
    r.proof_schema ?? r.proof_requirement,
    {},
  );
  const schema: ProofSchema = {
    photos: {
      min: p.photos?.min == null ? 0 : num(p.photos.min),
      must_show: Array.isArray(p.photos?.must_show) ? p.photos.must_show.map(String) : [],
    },
  };
  if (p.geofence_m != null) schema.geofence_m = num(p.geofence_m);
  if (Array.isArray(p.fields)) schema.fields = p.fields as ProofSchema['fields'];
  return schema;
}

function mapJob(r: Row): Job {
  const budget_cents = r.budget_cents != null ? num(r.budget_cents) : (usdToCents(r.budget_usd) ?? 0);
  let fee_cents = r.fee_cents != null ? num(r.fee_cents) : usdToCents(r.fee_usd);
  let worker_pay_cents = r.worker_pay_cents != null ? num(r.worker_pay_cents) : usdToCents(r.worker_pay_usd);
  if (fee_cents == null || worker_pay_cents == null) {
    const split = feeSplit(budget_cents);
    fee_cents = fee_cents ?? split.fee;
    worker_pay_cents = worker_pay_cents ?? split.worker;
  }
  return {
    id: String(r.id),
    task_type: taskTypeOf(r),
    budget_cents,
    worker_pay_cents,
    fee_cents,
    lat: num(r.lat),
    lng: num(r.lng),
    accepted_at: date(r.accepted_at), // not in contracts/schema.sql yet: null -> the time check asks for review
    deadline: date(r.deadline) as Date,
    proof_schema: proofSchemaOf(r),
    required_tier: num(r.required_tier ?? 0),
    status: r.status as Job['status'],
    worker_id: r.worker_id == null ? null : String(r.worker_id),
    risk_class: r.risk_class == null ? null : String(r.risk_class),
    certification_required: r.certification_required == null ? null : String(r.certification_required),
  };
}

/** media rows may carry {url, kind, exif} (contract) or {url, sha256, mime} (this package). */
function mimeOf(m: Record<string, unknown>): string {
  if (typeof m.mime === 'string' && m.mime) return m.mime;
  const kind = typeof m.kind === 'string' ? m.kind.toLowerCase() : '';
  const url = typeof m.url === 'string' ? (m.url.toLowerCase().split('?')[0] ?? '') : '';
  if (kind === 'video' || /\.(mp4|mov|webm)$/.test(url)) return 'video/mp4';
  if (kind === 'photo' || kind === 'image' || /\.(jpe?g|png|heic|webp)$/.test(url)) {
    return url.endsWith('.png') ? 'image/png' : 'image/jpeg';
  }
  return 'application/octet-stream';
}

function mapMedia(v: unknown): ProofMedia[] {
  return json<unknown[]>(v, [])
    .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
    .map((m) => ({
      url: String(m.url ?? ''),
      // no hash in the contract's media rows yet; an empty sha256 is skipped by the reuse check
      sha256: typeof m.sha256 === 'string' ? m.sha256 : '',
      mime: mimeOf(m),
    }));
}
function mapWorker(r: Row): Worker {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    phone: String(r.phone ?? ''),
    stripe_connect_account: r.stripe_connect_account == null ? null : String(r.stripe_connect_account),
    tier: num(r.tier ?? 0),
    suspended: Boolean(r.suspended),
  };
}
function mapProof(r: Row): Proof {
  return {
    id: String(r.id),
    job_id: String(r.job_id),
    worker_id: String(r.worker_id),
    media: mapMedia(r.media),
    fields: json(r.fields, {}),
    gps_lat: r.gps_lat == null ? null : num(r.gps_lat),
    gps_lng: r.gps_lng == null ? null : num(r.gps_lng),
    captured_at: date(r.captured_at),
  };
}
function mapEscrow(r: Row): Escrow {
  return {
    job_id: String(r.job_id),
    stripe_checkout_session_id: r.stripe_checkout_session_id == null ? null : String(r.stripe_checkout_session_id),
    stripe_payment_intent_id: r.stripe_payment_intent_id == null ? null : String(r.stripe_payment_intent_id),
    amount_cents: num(r.amount_cents),
    status: r.status as EscrowStatus,
    authorization_expires_at: date(r.authorization_expires_at),
    created_at: date(r.created_at) as Date,
    updated_at: date(r.updated_at) as Date,
  };
}
function mapLedger(r: Row): LedgerEntry {
  return {
    id: String(r.id),
    job_id: r.job_id == null ? null : String(r.job_id),
    kind: r.kind as LedgerEntry['kind'],
    // rows written by other packages (contracts/schema.sql) carry amount_usd only
    amount_cents: r.amount_cents != null ? num(r.amount_cents) : (usdToCents(r.amount_usd) ?? 0),
    currency: String(r.currency ?? 'usd'),
    stripe_ref: r.stripe_ref == null ? (r.ref == null ? null : String(r.ref)) : String(r.stripe_ref),
    idempotency_key: r.idempotency_key == null ? '' : String(r.idempotency_key),
    created_at: date(r.created_at) as Date,
  };
}
function mapVerification(r: Row): WorkerVerification {
  return {
    worker_id: String(r.worker_id),
    kind: r.kind as VerificationKind,
    status: r.status as WorkerVerification['status'],
    provider_ref: r.provider_ref == null ? null : String(r.provider_ref),
    details: json(r.details, {}),
    verified_at: date(r.verified_at),
    expires_at: date(r.expires_at),
  };
}
function mapReview(r: Row): ProofReview {
  return {
    proof_id: String(r.proof_id),
    job_id: String(r.job_id),
    confidence: r.confidence == null ? null : num(r.confidence),
    decision: r.decision as ProofReview['decision'],
    checks: json(r.checks, []),
    reviewer: String(r.reviewer ?? ''),
    created_at: date(r.created_at) as Date,
  };
}
function mapNotary(r: Row): NotaryRecord {
  return {
    commission_number: String(r.commission_number),
    full_name: String(r.full_name ?? ''),
    name_normalized: String(r.name_normalized ?? ''),
    county: r.county == null ? null : String(r.county),
    city: r.city == null ? null : String(r.city),
    business_name: r.business_name == null ? null : String(r.business_name),
    commission_expires: dateOnly(r.commission_expires),
    raw: json(r.raw, {}),
    imported_at: date(r.imported_at) ?? undefined,
  };
}

function mapPayout(r: Row): Payout {
  return {
    job_id: String(r.job_id),
    worker_id: String(r.worker_id),
    amount_cents: num(r.amount_cents),
    status: r.status as Payout['status'],
    stripe_transfer_id: r.stripe_transfer_id == null ? null : String(r.stripe_transfer_id),
    stripe_connect_account: r.stripe_connect_account == null ? null : String(r.stripe_connect_account),
    onboarding_url: r.onboarding_url == null ? null : String(r.onboarding_url),
    created_at: date(r.created_at) as Date,
    updated_at: date(r.updated_at) as Date,
  };
}
function mapDispute(r: Row): Dispute {
  return {
    id: String(r.id),
    job_id: r.job_id == null ? null : String(r.job_id),
    stripe_charge_id: String(r.stripe_charge_id),
    stripe_payment_intent_id: r.stripe_payment_intent_id == null ? null : String(r.stripe_payment_intent_id),
    amount_cents: num(r.amount_cents),
    currency: String(r.currency ?? 'usd'),
    reason: r.reason == null ? null : String(r.reason),
    status: r.status as Dispute['status'],
    evidence_due_by: date(r.evidence_due_by),
    evidence: json(r.evidence, {}),
    evidence_submitted_at: date(r.evidence_submitted_at),
    opened_at: date(r.opened_at) as Date,
    closed_at: date(r.closed_at),
    updated_at: date(r.updated_at) as Date,
  };
}

export class PostgresRepo implements Repo {
  constructor(private readonly sql: SqlClient) {}

  private async one<T>(text: string, params: unknown[], map: (r: Row) => T): Promise<T | null> {
    const { rows } = await this.sql.query(text, params);
    const r = rows[0];
    return r ? map(r) : null;
  }
  private async many<T>(text: string, params: unknown[], map: (r: Row) => T): Promise<T[]> {
    const { rows } = await this.sql.query(text, params);
    return rows.map(map);
  }

  getJob(id: string) {
    return this.one('select * from jobs where id = $1', [id], mapJob);
  }
  getWorker(id: string) {
    return this.one('select * from workers where id = $1', [id], mapWorker);
  }
  getWorkerByConnectAccount(accountId: string) {
    return this.one('select * from workers where stripe_connect_account = $1 limit 1', [accountId], mapWorker);
  }
  getProof(id: string) {
    return this.one('select * from proofs where id = $1', [id], mapProof);
  }
  getProofsForJob(jobId: string) {
    return this.many('select * from proofs where job_id = $1 order by created_at', [jobId], mapProof);
  }
  async findProofsByMediaSha256(sha256: string) {
    if (!sha256) return []; // contract media rows without a hash must not match each other
    return this.many(
      `select p.* from proofs p
       where exists (select 1 from jsonb_array_elements(p.media) m where m->>'sha256' = $1)`,
      [sha256],
      mapProof,
    );
  }
  async setWorkerConnectAccount(workerId: string, accountId: string) {
    await this.sql.query('update workers set stripe_connect_account = $2 where id = $1', [workerId, accountId]);
  }

  getEscrow(jobId: string) {
    return this.one('select * from escrows where job_id = $1', [jobId], mapEscrow);
  }
  getEscrowByPaymentIntent(paymentIntentId: string) {
    return this.one('select * from escrows where stripe_payment_intent_id = $1', [paymentIntentId], mapEscrow);
  }
  listEscrowsByStatus(status: EscrowStatus) {
    return this.many('select * from escrows where status = $1', [status], mapEscrow);
  }
  async insertEscrow(e: Omit<Escrow, 'created_at' | 'updated_at'>) {
    const row = await this.one(
      `insert into escrows (job_id, stripe_checkout_session_id, stripe_payment_intent_id, amount_cents, status, authorization_expires_at)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [e.job_id, e.stripe_checkout_session_id, e.stripe_payment_intent_id, e.amount_cents, e.status, e.authorization_expires_at],
      mapEscrow,
    );
    if (!row) throw new Error('insert escrows returned no row');
    return row;
  }
  async updateEscrow(jobId: string, patch: Partial<Escrow>) {
    const row = await this.one(
      `update escrows set
         stripe_payment_intent_id = coalesce($2, stripe_payment_intent_id),
         status = coalesce($3, status),
         authorization_expires_at = case when $4::boolean then $5 else authorization_expires_at end,
         updated_at = now()
       where job_id = $1 returning *`,
      [
        jobId,
        patch.stripe_payment_intent_id ?? null,
        patch.status ?? null,
        'authorization_expires_at' in patch,
        patch.authorization_expires_at ?? null,
      ],
      mapEscrow,
    );
    if (!row) throw new Error(`escrow for job ${jobId} not found`);
    return row;
  }

  async insertLedger(entry: NewLedgerEntry) {
    const inserted = await this.one(
      `insert into ledger (id, job_id, kind, amount_cents, amount_usd, currency, stripe_ref, idempotency_key)
       values (gen_random_uuid(), $1, $2, $3::integer, $3::integer / 100.0, $4, $5, $6)
       on conflict (idempotency_key) do nothing returning *`,
      [entry.job_id, entry.kind, entry.amount_cents, entry.currency ?? 'usd', entry.stripe_ref, entry.idempotency_key],
      mapLedger,
    );
    if (inserted) return { inserted: true, entry: inserted };
    const existing = await this.getLedgerByKey(entry.idempotency_key);
    if (!existing) throw new Error('ledger insert conflict but no existing row');
    return { inserted: false, entry: existing };
  }
  getLedgerByKey(idempotencyKey: string) {
    return this.one('select * from ledger where idempotency_key = $1', [idempotencyKey], mapLedger);
  }
  findLedgerByStripeRef(stripeRef: string) {
    return this.many('select * from ledger where stripe_ref = $1 order by created_at', [stripeRef], mapLedger);
  }
  listLedger(q: LedgerQuery) {
    return this.many(
      `select * from ledger
       where ($1::timestamptz is null or created_at >= $1)
         and ($2::timestamptz is null or created_at < $2)
         and ($3::text is null or kind = $3)
         and ($4::uuid is null or job_id = $4)
       order by created_at`,
      [q.from ?? null, q.to ?? null, q.kind ?? null, q.jobId ?? null],
      mapLedger,
    );
  }

  async hasStripeEvent(eventId: string) {
    const { rows } = await this.sql.query('select 1 from stripe_events where event_id = $1', [eventId]);
    return rows.length > 0;
  }
  async markStripeEvent(eventId: string, type: string) {
    const { rows } = await this.sql.query(
      'insert into stripe_events (event_id, type) values ($1, $2) on conflict (event_id) do nothing returning event_id',
      [eventId, type],
    );
    return rows.length > 0;
  }

  getWorkerVerification(workerId: string, kind: VerificationKind) {
    return this.one(
      'select * from worker_verifications where worker_id = $1 and kind = $2',
      [workerId, kind],
      mapVerification,
    );
  }
  async upsertWorkerVerification(v: WorkerVerification) {
    const row = await this.one(
      `insert into worker_verifications (worker_id, kind, status, provider_ref, details, verified_at, expires_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7)
       on conflict (worker_id, kind) do update set
         status = excluded.status, provider_ref = excluded.provider_ref, details = excluded.details,
         verified_at = excluded.verified_at, expires_at = excluded.expires_at
       returning *`,
      [v.worker_id, v.kind, v.status, v.provider_ref, JSON.stringify(v.details), v.verified_at, v.expires_at],
      mapVerification,
    );
    if (!row) throw new Error('upsert worker_verifications returned no row');
    return row;
  }

  getProofReview(proofId: string) {
    return this.one('select * from proof_reviews where proof_id = $1', [proofId], mapReview);
  }
  getLatestProofReviewForJob(jobId: string) {
    return this.one(
      'select * from proof_reviews where job_id = $1 order by created_at desc limit 1',
      [jobId],
      mapReview,
    );
  }
  async upsertProofReview(r: Omit<ProofReview, 'created_at'>) {
    const row = await this.one(
      `insert into proof_reviews (proof_id, job_id, confidence, decision, checks, reviewer)
       values ($1, $2, $3, $4, $5::jsonb, $6)
       on conflict (proof_id) do update set
         confidence = excluded.confidence, decision = excluded.decision, checks = excluded.checks, reviewer = excluded.reviewer
       returning *`,
      [r.proof_id, r.job_id, r.confidence, r.decision, JSON.stringify(r.checks), r.reviewer],
      mapReview,
    );
    if (!row) throw new Error('upsert proof_reviews returned no row');
    return row;
  }

  async upsertNotary(n: NotaryRecord) {
    await this.sql.query(
      `insert into notary_registry (commission_number, full_name, name_normalized, county, city, business_name, commission_expires, raw)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       on conflict (commission_number) do update set
         full_name = excluded.full_name, name_normalized = excluded.name_normalized, county = excluded.county,
         city = excluded.city, business_name = excluded.business_name, commission_expires = excluded.commission_expires,
         raw = excluded.raw, imported_at = now()`,
      [n.commission_number, n.full_name, n.name_normalized, n.county, n.city, n.business_name, isoDay(n.commission_expires), JSON.stringify(n.raw)],
    );
  }
  async upsertNotaries(records: NotaryRecord[]) {
    // Dedupe first: ON CONFLICT DO UPDATE cannot touch the same row twice in one statement.
    const byNumber = new Map<string, NotaryRecord>();
    for (const r of records) byNumber.set(r.commission_number, r);
    const unique = [...byNumber.values()];
    const CHUNK = 200; // 8 params per row -> 1,600 params per statement, far below the 65,535 limit
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: unknown[] = [];
      chunk.forEach((n, idx) => {
        const b = idx * 8;
        values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}::jsonb)`);
        params.push(
          n.commission_number, n.full_name, n.name_normalized, n.county, n.city, n.business_name,
          isoDay(n.commission_expires), JSON.stringify(n.raw),
        );
      });
      await this.sql.query(
        `insert into notary_registry (commission_number, full_name, name_normalized, county, city, business_name, commission_expires, raw)
         values ${values.join(', ')}
         on conflict (commission_number) do update set
           full_name = excluded.full_name, name_normalized = excluded.name_normalized, county = excluded.county,
           city = excluded.city, business_name = excluded.business_name, commission_expires = excluded.commission_expires,
           raw = excluded.raw, imported_at = now()`,
        params,
      );
    }
  }
  getNotary(commissionNumber: string) {
    return this.one('select * from notary_registry where commission_number = $1', [commissionNumber], mapNotary);
  }
  findNotariesByNormalizedName(nameNormalized: string) {
    return this.many('select * from notary_registry where name_normalized = $1', [nameNormalized], mapNotary);
  }

  getPayout(jobId: string) {
    return this.one('select * from payouts where job_id = $1', [jobId], mapPayout);
  }
  listPayoutsByWorker(workerId: string, status?: PayoutStatus) {
    return this.many(
      'select * from payouts where worker_id = $1 and ($2::text is null or status = $2) order by created_at',
      [workerId, status ?? null],
      mapPayout,
    );
  }
  async upsertPayout(p: Omit<Payout, 'created_at' | 'updated_at'>) {
    const row = await this.one(
      `insert into payouts (job_id, worker_id, amount_cents, status, stripe_transfer_id, stripe_connect_account, onboarding_url)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (job_id) do update set
         worker_id = excluded.worker_id, amount_cents = excluded.amount_cents, status = excluded.status,
         stripe_transfer_id = excluded.stripe_transfer_id, stripe_connect_account = excluded.stripe_connect_account,
         onboarding_url = excluded.onboarding_url, updated_at = now()
       returning *`,
      [p.job_id, p.worker_id, p.amount_cents, p.status, p.stripe_transfer_id, p.stripe_connect_account, p.onboarding_url],
      mapPayout,
    );
    if (!row) throw new Error('upsert payouts returned no row');
    return row;
  }

  getDispute(id: string) {
    return this.one('select * from disputes where id = $1', [id], mapDispute);
  }
  listDisputesForJob(jobId: string) {
    return this.many('select * from disputes where job_id = $1 order by opened_at', [jobId], mapDispute);
  }
  async upsertDispute(d: Omit<Dispute, 'updated_at'>) {
    const row = await this.one(
      `insert into disputes (id, job_id, stripe_charge_id, stripe_payment_intent_id, amount_cents, currency, reason, status,
                             evidence_due_by, evidence, evidence_submitted_at, opened_at, closed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
       on conflict (id) do update set
         job_id = coalesce(excluded.job_id, disputes.job_id), amount_cents = excluded.amount_cents, reason = excluded.reason,
         status = excluded.status, evidence_due_by = excluded.evidence_due_by, evidence = excluded.evidence,
         evidence_submitted_at = excluded.evidence_submitted_at, closed_at = excluded.closed_at, updated_at = now()
       returning *`,
      [
        d.id, d.job_id, d.stripe_charge_id, d.stripe_payment_intent_id, d.amount_cents, d.currency, d.reason, d.status,
        d.evidence_due_by, JSON.stringify(d.evidence), d.evidence_submitted_at, d.opened_at, d.closed_at,
      ],
      mapDispute,
    );
    if (!row) throw new Error('upsert disputes returned no row');
    return row;
  }
}
