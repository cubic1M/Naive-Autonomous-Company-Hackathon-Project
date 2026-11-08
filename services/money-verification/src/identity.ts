/**
 * Stripe Identity for workers. A tier-2 job (over $150, or any certification; see proof/profile.ts) needs
 * a verified identity: the worker opens a hosted Stripe Identity session (government ID plus a matching
 * selfie), Stripe reports the outcome by webhook, and the verified name on the ID is what verifyNotary
 * compares against the commission. One worker_verifications row per worker (kind 'identity'); the
 * verified first and last name live in its details and never in a proof review.
 */
import type Stripe from 'stripe';
import type { Env } from './env.js';
import { InvalidStateError, NotFoundError } from './errors.js';
import { fire, type Hooks } from './hooks.js';
import type { Repo } from './repo.js';
import type { StripeClient } from './stripe-client.js';
import type { VerificationStatus, WorkerVerification } from './types.js';

export interface IdentityDeps {
  stripe: Pick<StripeClient, 'identity'>;
  repo: Pick<Repo, 'getWorker' | 'getWorkerVerification' | 'upsertWorkerVerification'>;
  env: Pick<Env, 'PUBLIC_BASE_URL'>;
  hooks?: Hooks;
  now?: () => Date;
}

/** What worker_verifications.details holds for kind 'identity'. Every field is optional: rows may predate one. */
export interface IdentityDetails {
  /** Sessions started so far; the Stripe idempotency key is identity:<workerId>:<attempts>. */
  attempts?: number;
  session_id?: string;
  started_at?: string;
  /** Stripe session type ('document'). */
  type?: string;
  first_name?: string | null;
  last_name?: string | null;
  /** VerificationReport id (vr_...), where the document type and checks live in the Stripe dashboard. */
  last_verification_report?: string | null;
  last_error?: { code: string | null; reason: string | null } | null;
  /** Set when the verified session's outputs could not be fetched; the identity is still verified, the names are null. */
  verified_outputs_error?: string;
  [key: string]: unknown;
}

export interface IdentityStart {
  workerId: string;
  /** Hosted Stripe Identity URL to send the worker to; null when the identity is already verified. */
  url: string | null;
  status: VerificationStatus;
  sessionId: string | null;
}

export interface IdentityOutcome {
  workerId: string | null;
  /** True when a worker_verifications row was written (and onWorkerVerified fired). */
  changed: boolean;
  status: VerificationStatus | null;
  detail: string;
}

type Session = Stripe.Identity.VerificationSession;
type RecordDeps = Pick<IdentityDeps, 'stripe' | 'repo' | 'hooks' | 'now'>;

export const identityReturnUrl = (publicBaseUrl: string, workerId: string): string => `${publicBaseUrl}/join/${workerId}/identity/done`;

const detailsOf = (v: WorkerVerification | null): IdentityDetails => (v?.details ?? {}) as IdentityDetails;

function attemptsOf(v: WorkerVerification | null): number {
  const n = detailsOf(v).attempts;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

const refId = (x: string | { id: string } | null | undefined): string | null => (x ? (typeof x === 'string' ? x : x.id) : null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * metadata.worker_id is what we set; client_reference_id is the same value, kept as a fallback. Only a uuid can be
 * ours (workers.id and worker_verifications.worker_id are uuid): another integration's session on the same Stripe
 * account may carry any string, and querying the uuid column with it makes Postgres throw 22P02, the webhook answer
 * 500 and Stripe redeliver for days. Such a session is reported unhandled instead.
 */
const workerIdOf = (session: Session): string | null => {
  const id = (session.metadata?.worker_id || session.client_reference_id || '').trim();
  return UUID.test(id) ? id : null;
};

/** "First Last" from a verified identity row, or null when there is no verified identity (or no name on it). */
export function verifiedIdentityName(v: WorkerVerification | null): string | null {
  if (v?.status !== 'verified') return null;
  const d = detailsOf(v);
  const name = [d.first_name, d.last_name].filter((s): s is string => typeof s === 'string' && s.trim() !== '').join(' ').trim();
  return name === '' ? null : name;
}

/**
 * Open a Stripe Identity session for the worker and park a pending worker_verifications row. Each call is a
 * new attempt (new session) unless the identity is already verified; the attempt number is read back from
 * the row, so a retry after a failed write reuses the idempotency key and gets the same session. The URL
 * is single-use and short-lived, so it is returned, never stored.
 */
export async function startIdentityVerification(deps: IdentityDeps, workerId: string): Promise<IdentityStart> {
  const worker = await deps.repo.getWorker(workerId);
  if (!worker) throw new NotFoundError('worker', workerId);
  const existing = await deps.repo.getWorkerVerification(workerId, 'identity');
  if (existing?.status === 'verified') return { workerId, url: null, status: 'verified', sessionId: existing.provider_ref };

  const attempt = attemptsOf(existing) + 1;
  const session = await deps.stripe.identity.verificationSessions.create(
    {
      type: 'document',
      options: { document: { require_matching_selfie: true } },
      metadata: { worker_id: workerId },
      client_reference_id: workerId,
      return_url: identityReturnUrl(deps.env.PUBLIC_BASE_URL, workerId),
    },
    { idempotencyKey: `identity:${workerId}:${attempt}` },
  );
  if (!session.url) throw new InvalidStateError(`identity session ${session.id} for worker ${workerId} has no url`);

  const now = deps.now ?? (() => new Date());
  await deps.repo.upsertWorkerVerification({
    worker_id: workerId,
    kind: 'identity',
    status: 'pending',
    provider_ref: session.id,
    details: { ...detailsOf(existing), attempts: attempt, session_id: session.id, started_at: now().toISOString(), last_error: null },
    verified_at: null,
    expires_at: null,
  });
  return { workerId, url: session.url, status: 'pending', sessionId: session.id };
}

async function write(deps: RecordDeps, workerId: string, existing: WorkerVerification | null, session: Session, status: VerificationStatus, patch: IdentityDetails): Promise<void> {
  const now = deps.now ?? (() => new Date());
  await deps.repo.upsertWorkerVerification({
    worker_id: workerId,
    kind: 'identity',
    status,
    provider_ref: session.id,
    details: { ...detailsOf(existing), session_id: session.id, ...patch },
    verified_at: status === 'verified' ? now() : null,
    expires_at: null,
  });
  await fire(deps.hooks, 'onWorkerVerified', workerId, status);
}

/**
 * The verified name. The webhook payload never carries verified_outputs (observed against the sandbox on API
 * 2026-10-28: the key is absent, and it is expandable), so it is fetched with one expanded retrieve. A failed
 * fetch must not lose the verification: the names stay null and the error is recorded for a later refetch.
 */
async function verifiedOutputsOf(
  deps: Pick<IdentityDeps, 'stripe'>,
  session: Session,
): Promise<{ outputs: Stripe.Identity.VerificationSession.VerifiedOutputs | null; error: string | null }> {
  if (session.verified_outputs) return { outputs: session.verified_outputs, error: null };
  try {
    const full = await deps.stripe.identity.verificationSessions.retrieve(session.id, { expand: ['verified_outputs'] });
    return { outputs: full.verified_outputs ?? null, error: null };
  } catch (err) {
    return { outputs: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** identity.verification_session.verified: store the verified name and the report id, fire onWorkerVerified once. */
export async function recordIdentityVerified(deps: RecordDeps, session: Session): Promise<IdentityOutcome> {
  const workerId = workerIdOf(session);
  if (!workerId) return { workerId: null, changed: false, status: null, detail: `session ${session.id} has no worker_id` };
  const existing = await deps.repo.getWorkerVerification(workerId, 'identity');
  if (existing?.status === 'verified') return { workerId, changed: false, status: 'verified', detail: `worker ${workerId} already verified` };
  const { outputs, error } = await verifiedOutputsOf(deps, session);
  await write(deps, workerId, existing, session, 'verified', {
    type: session.type,
    first_name: outputs?.first_name ?? null,
    last_name: outputs?.last_name ?? null,
    last_verification_report: refId(session.last_verification_report),
    last_error: null,
    ...(error ? { verified_outputs_error: error } : {}),
  });
  return { workerId, changed: true, status: 'verified', detail: `worker ${workerId} verified${error ? ' (verified_outputs not fetched)' : ''}` };
}

const lastErrorOf = (session: Session): IdentityDetails['last_error'] =>
  session.last_error ? { code: session.last_error.code, reason: session.last_error.reason } : null;

/**
 * identity.verification_session.requires_input: a check failed (last_error says which) and the worker must
 * try again, so the row becomes needs_review. Without last_error the session is simply still open: no change.
 * A verified identity is never downgraded by a later event from an older session.
 */
export async function recordIdentityRequiresInput(deps: RecordDeps, session: Session): Promise<IdentityOutcome> {
  const workerId = workerIdOf(session);
  if (!workerId) return { workerId: null, changed: false, status: null, detail: `session ${session.id} has no worker_id` };
  const existing = await deps.repo.getWorkerVerification(workerId, 'identity');
  if (existing?.status === 'verified') return { workerId, changed: false, status: 'verified', detail: `worker ${workerId} already verified; requires_input ignored` };
  const lastError = lastErrorOf(session);
  if (!lastError) return { workerId, changed: false, status: existing?.status ?? null, detail: `session ${session.id} requires input and has no error: still open` };
  await write(deps, workerId, existing, session, 'needs_review', { last_error: lastError });
  return { workerId, changed: true, status: 'needs_review', detail: `worker ${workerId} needs review: ${lastError.code ?? 'unknown'}` };
}

/** identity.verification_session.canceled: the attempt is over without a result; the worker may start another. */
export async function recordIdentityCanceled(deps: RecordDeps, session: Session): Promise<IdentityOutcome> {
  const workerId = workerIdOf(session);
  if (!workerId) return { workerId: null, changed: false, status: null, detail: `session ${session.id} has no worker_id` };
  const existing = await deps.repo.getWorkerVerification(workerId, 'identity');
  if (existing?.status === 'verified') return { workerId, changed: false, status: 'verified', detail: `worker ${workerId} already verified; canceled ignored` };
  await write(deps, workerId, existing, session, 'failed', { last_error: lastErrorOf(session) });
  return { workerId, changed: true, status: 'failed', detail: `worker ${workerId} identity session canceled` };
}
