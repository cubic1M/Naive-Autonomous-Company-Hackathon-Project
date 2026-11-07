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

/** Payout exceeds PAYOUT_CAP_CENTS; a human must approve in Naive, then call release_payout_large. */
export class RequiresApprovalError extends MoneyVerificationError {
  readonly amountCents: number;
  readonly capCents: number;
  constructor(amountCents: number, capCents: number) {
    super('requires_approval', `payout of ${amountCents} cents exceeds cap of ${capCents} cents; requires human approval`);
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
