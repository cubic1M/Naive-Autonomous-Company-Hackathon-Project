import { randomUUID } from 'node:crypto';
import type { Repo, LedgerQuery } from '../repo.js';
import type {
  CustomerPayment,
  Dispute,
  Escrow,
  EscrowStatus,
  Job,
  JobLiability,
  LedgerEntry,
  LiabilityDecision,
  NewLedgerEntry,
  NotaryRecord,
  Payout,
  PayoutStatus,
  Proof,
  ProofReview,
  VerificationKind,
  Worker,
  WorkerVerification,
} from '../types.js';
import { NotFoundError } from '../errors.js';

/**
 * In-memory Repo for tests and local demos. Also holds teammates' tables (jobs/workers/proofs)
 * so the whole flow can run without Postgres. `now` is injectable for deterministic timestamps.
 */
export class InMemoryRepo implements Repo {
  jobs = new Map<string, Job>();
  customers = new Map<string, CustomerPayment>();
  /** jobs.customer_id, which the Job view does not carry: job id -> customer id. */
  jobCustomers = new Map<string, string>();
  workers = new Map<string, Worker>();
  proofs = new Map<string, Proof>();
  escrows = new Map<string, Escrow>();
  ledger: LedgerEntry[] = [];
  stripeEvents = new Map<string, { type: string; processed_at: Date }>();
  workerVerifications = new Map<string, WorkerVerification>();
  proofReviews = new Map<string, ProofReview>();
  notaries = new Map<string, NotaryRecord>();
  payouts = new Map<string, Payout>();
  disputes = new Map<string, Dispute>();
  jobLiability = new Map<string, JobLiability>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  // seeding helpers
  seedJob(job: Job): Job {
    this.jobs.set(job.id, job);
    return job;
  }
  seedWorker(worker: Worker): Worker {
    this.workers.set(worker.id, worker);
    return worker;
  }
  seedCustomer(customer: CustomerPayment): CustomerPayment {
    this.customers.set(customer.customer_id, { ...customer });
    return customer;
  }
  /** The job was requested by this customer (jobs.customer_id). */
  linkJobToCustomer(jobId: string, customerId: string): void {
    this.jobCustomers.set(jobId, customerId);
  }
  seedProof(proof: Proof): Proof {
    this.proofs.set(proof.id, proof);
    return proof;
  }

  async getJob(id: string) {
    return this.jobs.get(id) ?? null;
  }
  async getWorker(id: string) {
    return this.workers.get(id) ?? null;
  }
  async getWorkerByConnectAccount(accountId: string) {
    return [...this.workers.values()].find((w) => w.stripe_connect_account === accountId) ?? null;
  }
  async getProof(id: string) {
    return this.proofs.get(id) ?? null;
  }
  async getProofsForJob(jobId: string) {
    return [...this.proofs.values()].filter((p) => p.job_id === jobId);
  }
  async findProofsByMediaSha256(sha256: string) {
    if (!sha256) return [];
    return [...this.proofs.values()].filter((p) => p.media.some((m) => m.sha256 === sha256));
  }
  async setWorkerConnectAccount(workerId: string, accountId: string) {
    const w = this.workers.get(workerId);
    if (!w) throw new Error(`worker ${workerId} not found`);
    w.stripe_connect_account = accountId;
  }
  async getCustomerPayment(customerId: string) {
    const c = this.customers.get(customerId);
    return c ? { ...c } : null;
  }
  async getCustomerPaymentForJob(jobId: string) {
    const customerId = this.jobCustomers.get(jobId);
    return customerId ? this.getCustomerPayment(customerId) : null;
  }
  async setCustomerPayment(customerId: string, patch: Partial<Pick<CustomerPayment, 'stripe_customer_id' | 'default_payment_method_id'>>) {
    const c = this.customers.get(customerId);
    if (!c) throw new Error(`customer ${customerId} not found`);
    if (patch.stripe_customer_id != null) c.stripe_customer_id = patch.stripe_customer_id;
    if (patch.default_payment_method_id != null) c.default_payment_method_id = patch.default_payment_method_id;
  }

  async getEscrow(jobId: string) {
    return this.escrows.get(jobId) ?? null;
  }
  async getEscrowByPaymentIntent(paymentIntentId: string) {
    return [...this.escrows.values()].find((e) => e.stripe_payment_intent_id === paymentIntentId) ?? null;
  }
  async listEscrowsByStatus(status: EscrowStatus) {
    return [...this.escrows.values()].filter((e) => e.status === status);
  }
  async insertEscrow(escrow: Omit<Escrow, 'created_at' | 'updated_at'>) {
    if (this.escrows.has(escrow.job_id)) throw new Error(`escrow for job ${escrow.job_id} already exists`);
    const t = this.now();
    const row: Escrow = { ...escrow, created_at: t, updated_at: t };
    this.escrows.set(row.job_id, row);
    return row;
  }
  async updateEscrow(jobId: string, patch: Partial<Escrow>) {
    const e = this.escrows.get(jobId);
    if (!e) throw new Error(`escrow for job ${jobId} not found`);
    const next: Escrow = { ...e, ...patch, job_id: e.job_id, updated_at: this.now() };
    this.escrows.set(jobId, next);
    return next;
  }

  async insertLedger(entry: NewLedgerEntry) {
    const existing = this.ledger.find((l) => l.idempotency_key === entry.idempotency_key);
    if (existing) return { inserted: false, entry: existing };
    const row: LedgerEntry = {
      id: randomUUID(),
      job_id: entry.job_id,
      kind: entry.kind,
      amount_cents: entry.amount_cents,
      currency: entry.currency ?? 'usd',
      stripe_ref: entry.stripe_ref,
      idempotency_key: entry.idempotency_key,
      created_at: this.now(),
    };
    this.ledger.push(row);
    return { inserted: true, entry: row };
  }
  async getLedgerByKey(idempotencyKey: string) {
    return this.ledger.find((l) => l.idempotency_key === idempotencyKey) ?? null;
  }
  async findLedgerByStripeRef(stripeRef: string) {
    return this.ledger.filter((l) => l.stripe_ref === stripeRef);
  }
  async listLedger(q: LedgerQuery) {
    return this.ledger.filter(
      (l) =>
        (!q.from || l.created_at >= q.from) &&
        (!q.to || l.created_at < q.to) &&
        (!q.kind || l.kind === q.kind) &&
        (!q.jobId || l.job_id === q.jobId),
    );
  }

  async hasStripeEvent(eventId: string) {
    return this.stripeEvents.has(eventId);
  }
  async markStripeEvent(eventId: string, type: string) {
    if (this.stripeEvents.has(eventId)) return false;
    this.stripeEvents.set(eventId, { type, processed_at: this.now() });
    return true;
  }

  private vkey(workerId: string, kind: VerificationKind) {
    return `${workerId}:${kind}`;
  }
  async getWorkerVerification(workerId: string, kind: VerificationKind) {
    return this.workerVerifications.get(this.vkey(workerId, kind)) ?? null;
  }
  async upsertWorkerVerification(v: WorkerVerification) {
    this.workerVerifications.set(this.vkey(v.worker_id, v.kind), { ...v });
    return v;
  }

  async getProofReview(proofId: string) {
    return this.proofReviews.get(proofId) ?? null;
  }
  async getLatestProofReviewForJob(jobId: string) {
    const rows = [...this.proofReviews.values()].filter((r) => r.job_id === jobId);
    rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return rows[0] ?? null;
  }
  async upsertProofReview(review: Omit<ProofReview, 'created_at'>) {
    const existing = this.proofReviews.get(review.proof_id);
    const row: ProofReview = { ...review, created_at: existing?.created_at ?? this.now() };
    this.proofReviews.set(row.proof_id, row);
    return row;
  }

  async upsertNotary(record: NotaryRecord) {
    this.notaries.set(record.commission_number, { ...record, imported_at: record.imported_at ?? this.now() });
  }
  async upsertNotaries(records: NotaryRecord[]) {
    for (const r of records) await this.upsertNotary(r);
  }
  async getNotary(commissionNumber: string) {
    return this.notaries.get(commissionNumber) ?? null;
  }
  async findNotariesByNormalizedName(nameNormalized: string) {
    return [...this.notaries.values()].filter((n) => n.name_normalized === nameNormalized);
  }

  async getPayout(jobId: string) {
    return this.payouts.get(jobId) ?? null;
  }
  async listPayoutsByWorker(workerId: string, status?: PayoutStatus) {
    return [...this.payouts.values()].filter((p) => p.worker_id === workerId && (!status || p.status === status));
  }
  async upsertPayout(p: Omit<Payout, 'created_at' | 'updated_at'>) {
    const existing = this.payouts.get(p.job_id);
    const t = this.now();
    const row: Payout = { ...p, created_at: existing?.created_at ?? t, updated_at: t };
    this.payouts.set(row.job_id, row);
    return row;
  }

  async getDispute(id: string) {
    return this.disputes.get(id) ?? null;
  }
  async listDisputesForJob(jobId: string) {
    return [...this.disputes.values()].filter((d) => d.job_id === jobId);
  }
  async upsertDispute(d: Omit<Dispute, 'updated_at'>) {
    const row: Dispute = { ...d, updated_at: this.now() };
    this.disputes.set(row.id, row);
    return row;
  }

  async getJobLiability(jobId: string) {
    const r = this.jobLiability.get(jobId);
    return r ? { ...r, tags: { ...r.tags, rules: [...r.tags.rules] } } : null;
  }

  async insertJobLiability(row: Pick<JobLiability, 'job_id' | 'tags' | 'pricing'>) {
    const existing = await this.getJobLiability(row.job_id);
    if (existing) return existing;
    const created: JobLiability = {
      job_id: row.job_id, tags: { ...row.tags, rules: [...row.tags.rules] }, pricing: row.pricing,
      model: null, rule_id: null, reason: null, policy_version: null, decided_by: null, decided_at: null,
      created_at: this.now(),
    };
    this.jobLiability.set(row.job_id, created);
    return { ...created };
  }

  async decideJobLiability(jobId: string, d: LiabilityDecision) {
    const r = this.jobLiability.get(jobId);
    if (!r) throw new NotFoundError('job_liability', jobId);
    if (r.model !== null) return { row: (await this.getJobLiability(jobId))!, changed: false };
    this.jobLiability.set(jobId, { ...r, ...d });
    return { row: (await this.getJobLiability(jobId))!, changed: true };
  }
}
