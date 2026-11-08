// Run: npx vitest run apps/api/src/lib (from the repo root).
// The job minimum lives in one place, services/money-verification/src/pricing.ts. The guide agents read must
// quote that value, never a copy (it said "≥ 20" after the minimum dropped to $3).
import { describe, expect, it } from "vitest";
import { MIN_JOB_PRICE_CENTS } from "../../../../services/money-verification/src/pricing";
import { guideMarkdown } from "./guide";

describe("job minimum in the customer guide", () => {
  const guide = guideMarkdown("https://api.operis.live", { testMode: false });
  const minUsd = MIN_JOB_PRICE_CENTS / 100;

  it("the budget_usd row and the Limits line both state MIN_JOB_PRICE_CENTS", () => {
    expect(guide).toMatch(new RegExp(`\\| \`budget_usd\` \\| number \\| ≥ ${minUsd}\\. `));
    expect(guide).toContain(`- Minimum job $${minUsd};`);
  });

  it("no longer mentions the old $20 minimum", () => {
    expect(guide).not.toMatch(/≥ 20\b|Minimum job \$20\b/);
  });
});
