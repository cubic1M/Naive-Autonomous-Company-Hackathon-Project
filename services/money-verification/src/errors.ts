export class MoneyVerificationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class NotFoundError extends MoneyVerificationError {
  constructor(what: string, id: string) {
    super('not_found', `${what} ${id} not found`);
  }
}

export class InvalidStateError extends MoneyVerificationError {
  constructor(message: string) {
    super('invalid_state', message);
  }
}

/**
 * A payout, or a job's cumulative refunds, would exceed PAYOUT_CAP_CENTS. Above the cap the CEO agent approves by
 * calling release_payout_large / refund_large with approved_by; no human is involved below the founders' hard ceiling.
 */
export class RequiresApprovalError extends MoneyVerificationError {
  readonly amountCents: number;
  readonly capCents: number;
  readonly kind: 'payout' | 'refund' | 'amount';
  constructor(amountCents: number, capCents: number, kind: 'payout' | 'refund' | 'amount' = 'amount') {
    const tool = kind === 'refund' ? 'refund_large' : 'release_payout_large';
    super('requires_approval', `${kind} of ${amountCents} cents exceeds the cap of ${capCents} cents; ask the CEO agent to approve it with ${tool}`);
    this.kind = kind;
    this.amountCents = amountCents;
    this.capCents = capCents;
  }
}

export class DailyCapExceededError extends MoneyVerificationError {
  constructor(attemptedCents: number, heldTodayCents: number, capCents: number) {
    super(
      'daily_cap_exceeded',
      `escrow of ${attemptedCents} cents would bring today's holds to ${heldTodayCents + attemptedCents} cents, over the cap of ${capCents}`,
    );
  }
}

export class NotEligibleError extends MoneyVerificationError {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super('not_eligible', `not eligible: ${reasons.join('; ')}`);
    this.reasons = reasons;
  }
}

/** Stripe-Signature header missing or does not match the raw body. The webhook handler answers 400. */
export class WebhookSignatureError extends MoneyVerificationError {
  constructor(message: string) {
    super('webhook_signature', message);
  }
}
