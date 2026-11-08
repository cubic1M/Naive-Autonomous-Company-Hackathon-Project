// The Stripe mode this deployment runs in (from STRIPE_SECRET_KEY) and the customer-facing payment text that depends
// on it. Test-card hints (pm_card_visa, card 4242 ...) only work with a test key: a live key rejects them.
// Relative import on purpose: this file and guide.ts stay runnable under plain vitest (no @/ alias).
import { stripeModeFromEnv, type StripeKeySource } from "../../../../services/money-verification/src/stripe-mode";

/** True with an sk_test_/rk_test_ key or no key. An unrecognised key counts as not test: never show test hints then. */
export function stripeTestMode(env: StripeKeySource = process.env): boolean {
  try {
    return stripeModeFromEnv(env) === "test";
  } catch {
    return false;
  }
}

/** Why request_human's payment.payment_method (or a saved card) was not found on Operis's Stripe account. */
export function unknownPaymentMethodText(testMode = stripeTestMode()): string {
  return testMode
    ? "that payment method is unknown to Operis's Stripe account (pass a pm_... created there; in test mode pm_card_visa)"
    : "that payment method does not exist on Operis's live Stripe account (test ids such as pm_card_visa only work with test keys); pass a live pm_... created with Operis's publishable key, or call setup_payment and have your owner save a real card";
}
