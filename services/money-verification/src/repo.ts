import type {
  Dispute,
  Escrow,
  EscrowStatus,
  Job,
  LedgerEntry,
  LedgerKind,
  NewLedgerEntry,
  NotaryRecord,
  Payout,
  PayoutStatus,
  Proof,
  ProofReview,
  VerificationKind,
  Worker,
  WorkerVerification,
} from './types.js';

export interface LedgerQuery {
  from?: Date;
  to?: Date;
  kind?: LedgerKind;
  jobId?: string;
}

/**
 * Persistence boundary. `InMemoryRepo` (tests) and `PostgresRepo` (prod) implement it.
 * Reads of jobs/workers/proofs hit teammates' tables; everything else is tables owned by this package
 * (see migrations/0001_money_verification.sql).
 */
export interface Repo {
  // ---- teammates' tables (read) ----
  getJob(id: string): Promise<Job | null>;
  getWorker(id: string): Promise<Worker | null>;
  /** Worker whose stripe_connect_account equals the given Connect account id (account.updated webhook). */
  getWorkerByConnectAccount(accountId: string): Promise<Worker | null>;
  getProof(id: string): Promise<Proof | null>;
  getProofsForJob(jobId: string): Promise<Proof[]>;
  /** Proofs (any job) whose media array contains the given sha256. */
  findProofsByMediaSha256(sha256: string): Promise<Proof[]>;
  /** The ONE write to a teammates' table: persist the Connect account id created by payouts.ts. */
  setWorkerConnectAccount(workerId: string, accountId: string): Promise<void>;

  // ---- escrows ----
  getEscrow(jobId: string): Promise<Escrow | null>;
  getEscrowByPaymentIntent(paymentIntentId: string): Promise<Escrow | null>;
  listEscrowsByStatus(status: EscrowStatus): Promise<Escrow[]>;
  insertEscrow(escrow: Omit<Escrow, 'created_at' | 'updated_at'>): Promise<Escrow>;
  updateEscrow(
    jobId: string,
    patch: Partial<Pick<Escrow, 'stripe_payment_intent_id' | 'status' | 'authorization_expires_at'>>,
  ): Promise<Escrow>;

  // ---- ledger (append-only) ----
  /** Insert unless idempotency_key exists. Returns { inserted: false, entry } with the existing row on conflict. */
  insertLedger(entry: NewLedgerEntry): Promise<{ inserted: boolean; entry: LedgerEntry }>;
  getLedgerByKey(idempotencyKey: string): Promise<LedgerEntry | null>;
  /** Ledger lines carrying this Stripe object id (e.g. a charge id -> its escrow_capture line). */
  findLedgerByStripeRef(stripeRef: string): Promise<LedgerEntry[]>;
  listLedger(query: LedgerQuery): Promise<LedgerEntry[]>;

  // ---- stripe_events ----
  /** True if this event id was already processed. Check -> handle -> mark, so a failed handler can be retried. */
  hasStripeEvent(eventId: string): Promise<boolean>;
  /** Record event id; false if it was already recorded (duplicate delivery). */
  markStripeEvent(eventId: string, type: string): Promise<boolean>;

  // ---- payouts ----
  getPayout(jobId: string): Promise<Payout | null>;
  listPayoutsByWorker(workerId: string, status?: PayoutStatus): Promise<Payout[]>;
  upsertPayout(payout: Omit<Payout, 'created_at' | 'updated_at'>): Promise<Payout>;

  // ---- worker_verifications ----
  getWorkerVerification(workerId: string, kind: VerificationKind): Promise<WorkerVerification | null>;
  upsertWorkerVerification(v: WorkerVerification): Promise<WorkerVerification>;

  // ---- proof_reviews ----
  getProofReview(proofId: string): Promise<ProofReview | null>;
  getLatestProofReviewForJob(jobId: string): Promise<ProofReview | null>;
  upsertProofReview(review: Omit<ProofReview, 'created_at'>): Promise<ProofReview>;

  // ---- notary_registry ----
  upsertNotary(record: NotaryRecord): Promise<void>;
  /** Batch upsert for the CA Secretary of State listing (~150k rows); duplicates within the batch: last wins. */
  upsertNotaries(records: NotaryRecord[]): Promise<void>;
  getNotary(commissionNumber: string): Promise<NotaryRecord | null>;
  findNotariesByNormalizedName(nameNormalized: string): Promise<NotaryRecord[]>;

  // ---- disputes ----
  getDispute(id: string): Promise<Dispute | null>;
  listDisputesForJob(jobId: string): Promise<Dispute[]>;
  upsertDispute(dispute: Omit<Dispute, 'updated_at'>): Promise<Dispute>;
}
