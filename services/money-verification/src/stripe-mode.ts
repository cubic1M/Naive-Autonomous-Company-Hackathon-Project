import { MoneyVerificationError } from './errors.js';

/**
 * Which Stripe mode a key talks to. A live key cannot see any object created with a test key (and vice versa): every
 * stored id from the other mode answers `resource_missing`. Stripe ids do not say their mode, so rows that store them
 * also store `stripe_livemode` (migration 0005), and the repo treats ids of the other mode as absent.
 */
export type StripeMode = 'live' | 'test';

/** process.env, or any object carrying the key (tests). The union keeps Next's augmented ProcessEnv assignable. */
export type StripeKeySource = NodeJS.ProcessEnv | { STRIPE_SECRET_KEY?: string };

const PREFIX = /^(?:sk|rk)_(live|test)_/;

/** sk_live_/rk_live_ -> live, sk_test_/rk_test_ -> test; anything else is a configuration error (value not echoed). */
export function stripeModeOfKey(key: string): StripeMode {
  const m = PREFIX.exec(key);
  if (!m) throw new MoneyVerificationError('config', 'STRIPE_SECRET_KEY must be a secret or restricted key (sk_live_, rk_live_, sk_test_ or rk_test_)');
  return m[1] as StripeMode;
}

/** The mode of STRIPE_SECRET_KEY; test when it is unset (read-only tools run without a key, and no live id exists then). */
export function stripeModeFromEnv(source: StripeKeySource = process.env): StripeMode {
  const key = (source as { STRIPE_SECRET_KEY?: string }).STRIPE_SECRET_KEY;
  return key ? stripeModeOfKey(key) : 'test';
}

/** A stored stripe_livemode flag. Null/absent means the row predates migration 0005, when only the sandbox existed: test. */
export const modeOfLivemode = (v: unknown): StripeMode => (v === true ? 'live' : 'test');
