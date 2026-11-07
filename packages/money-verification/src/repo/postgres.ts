import type { Repo, LedgerQuery } from '../repo.js';
import type {
  Escrow,
  EscrowStatus,
  Job,
  LedgerEntry,
  NewLedgerEntry,
  NotaryRecord,
  Proof,
  ProofReview,
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

function mapJob(r: Row): Job {
  return {
    id: String(r.id),
    task_type: String(r.task_type),
    budget_cents: num(r.budget_cents),
    worker_pay_cents: num(r.worker_pay_cents),
    fee_cents: num(r.fee_cents),
    lat: num(r.lat),
    lng: num(r.lng),
    accepted_at: date(r.accepted_at),
    deadline: date(r.deadline) as Date,
    proof_schema: json(r.proof_schema, { photos: { min: 0, must_show: [] } }),
    required_tier: num(r.required_tier ?? 0),
    status: r.status as Job['status'],
    worker_id: r.worker_id == null ? null : String(r.worker_id),
    risk_class: r.risk_class == null ? null : String(r.risk_class),
  };
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
    media: json(r.media, []),
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
    amount_cents: num(r.amount_cents),
    currency: String(r.currency ?? 'usd'),
    stripe_ref: r.stripe_ref == null ? null : String(r.stripe_ref),
    idempotency_key: String(r.idempotency_key),
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
    commission_expires: date(r.commission_expires),
    raw: json(r.raw, {}),
    imported_at: date(r.imported_at) ?? undefined,
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
  getProof(id: string) {
    return this.one('select * from proofs where id = $1', [id], mapProof);
  }
  getProofsForJob(jobId: string) {
    return this.many('select * from proofs where job_id = $1', [jobId], mapProof);
  }
  findProofsByMediaSha256(sha256: string) {
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
      `insert into ledger (id, job_id, kind, amount_cents, currency, stripe_ref, idempotency_key)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
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
      [n.commission_number, n.full_name, n.name_normalized, n.county, n.city, n.business_name, n.commission_expires, JSON.stringify(n.raw)],
    );
  }
  getNotary(commissionNumber: string) {
    return this.one('select * from notary_registry where commission_number = $1', [commissionNumber], mapNotary);
  }
  findNotariesByNormalizedName(nameNormalized: string) {
    return this.many('select * from notary_registry where name_normalized = $1', [nameNormalized], mapNotary);
  }
}
