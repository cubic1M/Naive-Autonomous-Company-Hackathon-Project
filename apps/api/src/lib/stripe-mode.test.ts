// Run: npx vitest run apps/api/src/lib (from the repo root). apps/api has no test script; these files import nothing
// through the @/ alias so plain vitest can run them.
import { describe, expect, it } from "vitest";
import { guideMarkdown } from "./guide";
import { stripeTestMode, unknownPaymentMethodText } from "./stripe-mode";

describe("stripeTestMode", () => {
  it("is true for test keys or no key, false for live keys and for anything unrecognised", () => {
    expect(stripeTestMode({ STRIPE_SECRET_KEY: "sk_test_x" })).toBe(true);
    expect(stripeTestMode({ STRIPE_SECRET_KEY: "rk_test_x" })).toBe(true);
    expect(stripeTestMode({})).toBe(true);
    expect(stripeTestMode({ STRIPE_SECRET_KEY: "sk_live_x" })).toBe(false);
    expect(stripeTestMode({ STRIPE_SECRET_KEY: "rk_live_x" })).toBe(false);
    expect(stripeTestMode({ STRIPE_SECRET_KEY: "garbage" })).toBe(false);
  });
});

describe("test-card hints follow the key's mode", () => {
  const api = "https://api.operis.live";
  it("the guide shows pm_card_visa and card 4242 only in test mode", () => {
    const test = guideMarkdown(api, { testMode: true });
    expect(test).toContain("pm_card_visa");
    expect(test).toContain("4242 4242 4242 4242");
    const live = guideMarkdown(api, { testMode: false });
    expect(live).not.toContain("pm_card_visa");
    expect(live).not.toContain("4242");
    expect(live).not.toMatch(/test mode/i);
    expect(live).toContain("setup_payment");
  });

  it("an unknown payment method is explained per mode; in live it says test ids do not work", () => {
    expect(unknownPaymentMethodText(true)).toContain("pm_card_visa");
    const live = unknownPaymentMethodText(false);
    expect(live).toMatch(/live/);
    expect(live).toMatch(/test.*pm_card_visa|pm_card_visa.*test/);
    expect(live).toContain("setup_payment");
  });
});
