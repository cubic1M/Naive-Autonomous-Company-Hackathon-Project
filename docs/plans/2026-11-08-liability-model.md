# Per-job Liability Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Compliance agent decides, for every funded job, whether Operis holds the liability (`operis`), only connects the customer with a licensed worker (`connector`), or refuses, under a versioned policy with code guardrails, and connector jobs on notary and legal work use a sliding platform fee charged on top.

**Architecture:** Pure policy, tagging and pricing live in `services/money-verification/src/liability/`; the decision is stored in a new package-owned table `job_liability`; a new shim `services/compliance/index.ts` binds it to Edwin's API the way `services/verify` does. Edwin's intake, wake map, internal MCP route, sweep and accept flow call the shim. The Compliance agent is a seventh Naive agent configured in `agents/agents.json`.

**Tech Stack:** TypeScript (ESM, NodeNext, strict), vitest, zod, Next.js route handlers in `apps/api`, postgres.js, Stripe (test mode), Naive managed agents.

**Spec:** `docs/specs/2026-11-08-liability-model-design.md` (approved by Cameron on 2026-11-08). Read it before Task 1.

## Global Constraints

- Policy version id: `2026-11-08`. Jurisdiction: California. Setup: insurance none, company licences none.
- Models: `operis`, `connector`, `refuse`. Rule ids: `L1` notarial acts (connector, notary commission check), `L2` legal services (connector, State Bar check), `L3` licensed trades, `L4` real estate brokerage, `L5` licensed security work, `L6` paid tax preparation (all four refuse until a verifier exists), `D` everything else (operis), `U` unsure or no decision in time (connector), plus `R` unsafe or illegal work that intake missed (refuse). `R` is an addition to the spec; say so in the PR.
- Standard pricing is unchanged: `quote()` in `src/pricing.ts`, fee 25% of the budget rounded half-up, worker 75%.
- Connector pricing (L1, L2 only): worker pay = 100% of the budget; platform fee = 20% of the first $100 + 10% of the part from $100 to $500 + 5% of the part above $500, rounded half-up to the cent. Examples: $20 → $4.00, $200 → $30.00, $1,000 → $85.00.
- Invariant: the amount held on the card is always worker pay + fee (`escrowAmountCents` already computes this from the jobs row).
- Fallback: the existing five-minute `/api/cron/sweep` decides any `held` job with no decision fifteen minutes after its `held` wake event.
- Jobs whose tags force `refuse` (L3 to L6) are rejected at intake before payment. This refines the spec's flow (same outcome, no card hold); say so in the PR.
- Migration `services/money-verification/migrations/0003_job_liability.sql`, plain idempotent SQL. Never run it. Never run `npm run agents:setup`. Never merge.
- Shared files edited by this PR (tell Cameron to ask Edwin to stay out of them while it is open): `contracts/states.ts`, `apps/api/src/lib/naive.ts`, `apps/api/src/lib/safety.ts`, `apps/api/src/lib/sweep.ts`, `apps/api/src/lib/worker.ts`, `apps/api/src/tools/edwin.ts`, `apps/api/src/app/mcp/internal/route.ts`, `apps/api/src/app/v1/worker/jobs/[token]/accept/route.ts`, `apps/api/src/lib/guide.ts`, `scripts/migrate.ts`, `agents/agents.json`, `agents/prompts/ceo.md`, `agents/prompts/disputes.md`. New files: `apps/api/src/tools/liability.ts`, `apps/api/src/app/v1/worker/license/route.ts`, `agents/prompts/compliance.md`. Never edit `apps/web` (Dora's): her changes go in the PR body as paste-ready snippets.
- PRs #23 (agent-payable escrow) and #30 (verification hardening) are open and touch `src/repo.ts`, `src/repo/{memory,postgres}.ts`, `src/types.ts`, `src/tools.ts`, `src/tools/schemas.ts`, `src/eligibility.ts` and the README. Keep your hunks in those files to the lines you add; never reformat or reorder. Rebase onto `origin/claude/zealous-newton-ld8eog` before every push and re-run all checks. If #30 has merged and `src/proof/profile.ts` exports a certification normaliser, import it in Task 1 instead of defining `normalizeCertification`.
- No real personal data in fixtures: the State Bar fixtures are synthetic pages with an invented name and number.
- Stripe: test mode only, CLI profile `-p operis`, never open `~/.config/stripe/config.toml`, never print a key.
- Usage: you run on Opus 5.5. No Workflow fan-outs; at most two Sonnet subagents, for tests from a spec you wrote. Draft test fixtures, the PR body and prompt prose with the local model first (`~/.local/bin/local-llm`, MTPLX at 127.0.0.1:8000, low effort, one request at a time; never Ollama), then correct every line yourself. Never the local model for decision, pricing, eligibility or SQL code.
- Checks (binaries are hoisted to the repo root): in `services/money-verification` run `../../node_modules/.bin/tsc --noEmit` and `../../node_modules/.bin/vitest run`; for the shims, a bundler-resolution tsconfig over `services/payments/index.ts`, `services/verify/index.ts` and `services/compliance/index.ts` (copy the approach in PR #17's body); for the API, `npm --prefix apps/api run typecheck`. One logical change per commit, real check output in the commit message.

---

### Task 1: Liability policy and intake tags

**Files:**
- Create: `services/money-verification/src/liability/policy.ts`
- Create: `services/money-verification/src/liability/tags.ts`
- Test: `services/money-verification/test/liability-tags.test.ts`

**Interfaces:**
- Produces: `POLICY_VERSION: string`, `type LiabilityModel = 'operis' | 'connector' | 'refuse'`, `type RuleId = 'L1'|'L2'|'L3'|'L4'|'L5'|'L6'|'D'|'U'|'R'`, `type LicenceKind = 'notary_commission' | 'attorney_license'`, `interface LiabilityRule { id; title; description; model; licence: LicenceKind | null; keywords: RegExp[] }`, `RULES: readonly LiabilityRule[]`, `ruleById(id: string): LiabilityRule | undefined`, `policyText(): string`, `type Pricing = 'standard' | 'connector'`, `interface JobTags { rules: RuleId[]; forced: 'connector' | 'refuse' | null; pricing: Pricing }`, `normalizeCertification(v: string | null | undefined): string | null`, `tagJob(input: { title: string; instructions: string; certification_required: string | null }): JobTags`.

- [ ] **Step 1: Write the failing test**

```ts
// services/money-verification/test/liability-tags.test.ts
import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, RULES, policyText, ruleById } from '../src/liability/policy.js';
import { normalizeCertification, tagJob } from '../src/liability/tags.js';

const job = (title: string, instructions = '', certification_required: string | null = null) => ({ title, instructions, certification_required });

describe('liability policy', () => {
  it('has unique rule ids and a description for each', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'D', 'U', 'R']);
    for (const r of RULES) expect(r.description.length).toBeGreaterThan(20);
  });
  it('renders every rule and the setup into the agent-facing text', () => {
    const text = policyText();
    expect(text).toContain(`Liability policy ${POLICY_VERSION}`);
    expect(text).toContain('insurance none');
    for (const r of RULES) expect(text).toContain(`${r.id} ${r.title}`);
  });
  it('looks rules up by id', () => {
    expect(ruleById('L2')?.licence).toBe('attorney_license');
    expect(ruleById('nope')).toBeUndefined();
  });
});

describe('tagJob', () => {
  const table: Array<[string, ReturnType<typeof job>, string[], 'connector' | 'refuse' | null, 'standard' | 'connector']> = [
    ['plain photo job', job('Photograph the YC sign', 'Two photos at the entrance'), [], null, 'standard'],
    ['wait in line', job('Wait in line at the DMV', 'Hold a spot until 3pm'), [], null, 'standard'],
    ['notarize', job('Notarize a deed', 'Mobile notary at our office'), ['L1'], 'connector', 'connector'],
    ['notary via certification', job('Witness a signature', 'At our office', 'California notary commission'), ['L1'], 'connector', 'connector'],
    ['signing agent', job('Loan signing agent needed', 'Refinance packet'), ['L1'], 'connector', 'connector'],
    ['contract review', job('Review our SaaS terms of service', 'Online contract review'), ['L2'], 'connector', 'connector'],
    ['legal advice', job('Need legal advice on a lease', 'Thirty minute call'), ['L2'], 'connector', 'connector'],
    ['bar licence certification', job('Look over an NDA', 'Two pages', 'California bar license'), ['L2'], 'connector', 'connector'],
    ['electrical', job('Rewire a kitchen outlet', 'Replace the wiring'), ['L3'], 'refuse', 'standard'],
    ['plumbing', job('Fix a leaking pipe', 'Plumbing under the sink'), ['L3'], 'refuse', 'standard'],
    ['handyman', job('Assemble an IKEA desk', 'Bring a screwdriver'), [], null, 'standard'],
    ['realtor', job('Real estate agent to list my house', 'Sunset district'), ['L4'], 'refuse', 'standard'],
    ['security', job('Security guard for an event', 'Friday night'), ['L5'], 'refuse', 'standard'],
    ['tax', job('Prepare my tax return', '1040 with schedule C'), ['L6'], 'refuse', 'standard'],
    ['notary and trade', job('Notarize permit and rewire the panel', ''), ['L1', 'L3'], 'refuse', 'standard'],
    ['counseling is not counsel', job('Peer counseling session notes', 'Type up notes'), [], null, 'standard'],
    ['certification none', job('Photograph a storefront', '', 'none'), [], null, 'standard'],
    ['certification N/A', job('Deliver a letter', '', 'N/A'), [], null, 'standard'],
  ];
  it.each(table)('%s', (_name, input, rules, forced, pricing) => {
    expect(tagJob(input)).toEqual({ rules, forced, pricing });
  });
});

describe('normalizeCertification', () => {
  it('treats negative words as no certification', () => {
    for (const v of ['', ' ', '-', 'none', 'No', 'N/A', 'na', 'nil', 'NULL', 'false', 'not required', 'Not applicable']) {
      expect(normalizeCertification(v)).toBeNull();
    }
    expect(normalizeCertification(null)).toBeNull();
    expect(normalizeCertification(' Notary commission ')).toBe('Notary commission');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/money-verification && ../../node_modules/.bin/vitest run test/liability-tags.test.ts`
Expected: FAIL, cannot find module `../src/liability/policy.js`.

- [ ] **Step 3: Write the policy**

```ts
// services/money-verification/src/liability/policy.ts
// Per-job liability policy (docs/specs/2026-11-08-liability-model-design.md). Draft for counsel, not legal advice.
// Growing is an edit here: insurance or a company licence moves a category to operis; a new licence verifier
// moves a refuse category to connector.
export const POLICY_VERSION = '2026-11-08';

export type LiabilityModel = 'operis' | 'connector' | 'refuse';
export type RuleId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'D' | 'U' | 'R';
export type LicenceKind = 'notary_commission' | 'attorney_license';

export interface LiabilityRule {
  id: RuleId;
  title: string;
  /** Plain-language rule the Compliance agent reads. */
  description: string;
  model: LiabilityModel;
  /** Licence the worker must hold, checked before accept; null when none. */
  licence: LicenceKind | null;
  /** Intake keywords matched against title, instructions and certification_required. Empty for D, U and R. */
  keywords: RegExp[];
}

/** What Operis has today. */
export const SETUP = { jurisdiction: 'California', insurance: [] as string[], companyLicences: [] as string[] };

export const RULES: readonly LiabilityRule[] = [
  {
    id: 'L1', title: 'Notarial acts', model: 'connector', licence: 'notary_commission',
    description: 'Notarizing a document, acting as a notary or as a loan signing agent. Notary commissions are issued to individuals only, so Operis cannot hold this liability; the commissioned notary does.',
    keywords: [/\bnotar(y|ies|ize|ise|ized|ised|izing|ising|ization|isation|ial)\b/i, /\bsigning agent\b/i],
  },
  {
    id: 'L2', title: 'Legal services', model: 'connector', licence: 'attorney_license',
    description: 'Legal advice, legal document review or drafting, contract review, or anything else that is the practice of law. Only licensed attorneys may provide it and California does not allow non-lawyer ownership of legal services, so the attorney holds this liability.',
    keywords: [
      /\b(attorney|lawyer|counsel|paralegal)s?\b/i,
      /\blegal (advice|review|services?|opinion|documents?)\b/i,
      /\b(contract|lease|nda|terms of service) review\b/i,
      /\breview (our|my|the|a|this) (contract|lease|nda|terms of service|agreement)\b/i,
      /\bbar (license|licence|number|admission)\b/i,
    ],
  },
  {
    id: 'L3', title: 'Licensed trades', model: 'refuse', licence: null,
    description: 'Work that legally needs a contractor licence, such as electrical wiring, plumbing, HVAC, gas lines or structural work. Refused until Operis can verify contractor licences. Small handyman tasks such as assembling furniture are not L3.',
    keywords: [/\b(electrical wiring|rewir(e|ing)|electrician|plumb(er|ing)|hvac|gas line|load[- ]bearing|structural work|roofing|contractor'?s? licen[cs]e)\b/i],
  },
  {
    id: 'L4', title: 'Real estate brokerage', model: 'refuse', licence: null,
    description: 'Listing, selling, leasing or negotiating real estate for others for pay. Refused until Operis can verify broker licences.',
    keywords: [/\b(real estate (agent|broker)|realtor|list (my|our|a) (house|home|property))\b/i],
  },
  {
    id: 'L5', title: 'Licensed security work', model: 'refuse', licence: null,
    description: 'Security guard, bodyguard, patrol or private investigation work. Refused until Operis can verify those licences.',
    keywords: [/\b(security guard|bodyguard|bouncer|private investigat(or|ion))\b/i],
  },
  {
    id: 'L6', title: 'Paid tax preparation', model: 'refuse', licence: null,
    description: 'Preparing or filing tax returns for pay. Refused until Operis can verify preparer registration.',
    keywords: [/\b(tax return|tax prep(aration)?|file (my|our) taxes)\b/i],
  },
  {
    id: 'D', title: 'Everything else', model: 'operis', licence: null,
    description: 'A job that passed intake and matches none of the rules above. Operis is the provider and holds the liability.',
    keywords: [],
  },
  {
    id: 'U', title: 'Unsure or no decision in time', model: 'connector', licence: null,
    description: 'Use when you cannot tell whether a rule applies. The worker is the provider. The system also records U when no decision arrives within fifteen minutes.',
    keywords: [],
  },
  {
    id: 'R', title: 'Unsafe or illegal, missed at intake', model: 'refuse', licence: null,
    description: 'Use when the job is illegal, dangerous, identity work, surveillance or signing on someone\'s behalf and intake did not catch it.',
    keywords: [],
  },
];

export function ruleById(id: string): LiabilityRule | undefined {
  return RULES.find((r) => r.id === id);
}

/** The policy as the Compliance agent reads it (returned by get_liability_context). */
export function policyText(): string {
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'none');
  const setup = `Operis setup (${SETUP.jurisdiction}): insurance ${list(SETUP.insurance)}; company licences ${list(SETUP.companyLicences)}.`;
  const rules = RULES.map(
    (r) => `${r.id} ${r.title} -> ${r.model}${r.licence ? ` (worker licence checked before accept: ${r.licence})` : ''}. ${r.description}`,
  );
  return [`Liability policy ${POLICY_VERSION}`, setup, ...rules].join('\n');
}
```

- [ ] **Step 4: Write the tagger**

```ts
// services/money-verification/src/liability/tags.ts
import { RULES, type RuleId } from './policy.js';

export type Pricing = 'standard' | 'connector';

export interface JobTags {
  /** Rules whose intake keywords match, in policy order. */
  rules: RuleId[];
  /** A model the agent cannot overrule: refuse when any matched rule refuses, connector when one requires it. */
  forced: 'connector' | 'refuse' | null;
  /** Connector pricing only for L1/L2 jobs that are not refused. */
  pricing: Pricing;
}

const NEGATIVE = new Set(['', '-', 'none', 'no', 'n/a', 'na', 'nil', 'null', 'false', 'not required', 'not applicable']);

/** Customer agents write "none" or "N/A" instead of null; those mean no certification. */
export function normalizeCertification(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = value.trim();
  return NEGATIVE.has(v.toLowerCase()) ? null : v;
}

export function tagJob(input: { title: string; instructions: string; certification_required: string | null }): JobTags {
  const text = [input.title, input.instructions, normalizeCertification(input.certification_required) ?? ''].join('\n');
  const matched = RULES.filter((r) => r.keywords.some((k) => k.test(text)));
  const forced = matched.some((r) => r.model === 'refuse')
    ? 'refuse'
    : matched.some((r) => r.model === 'connector')
      ? 'connector'
      : null;
  return { rules: matched.map((r) => r.id), forced, pricing: forced === 'connector' ? 'connector' : 'standard' };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/money-verification && ../../node_modules/.bin/vitest run test/liability-tags.test.ts`
Expected: PASS. If a table row fails, fix the keyword, not the expectation, unless the expectation contradicts the spec.

- [ ] **Step 6: Commit**

```bash
git add services/money-verification/src/liability/policy.ts services/money-verification/src/liability/tags.ts services/money-verification/test/liability-tags.test.ts
git commit -m "money-verification: liability policy v1 and intake tags"
```

---

### Task 2: Connector pricing and intake quote

**Files:**
- Create: `services/money-verification/src/liability/pricing.ts`
- Test: `services/money-verification/test/liability-pricing.test.ts`

**Interfaces:**
- Consumes: `tagJob`, `JobTags`, `Pricing` (Task 1); `quote`, `MIN_JOB_PRICE_CENTS` from `src/pricing.ts`.
- Produces: `connectorFeeCents(budgetCents: number): number`, `interface JobQuote { tags: JobTags; pricing: Pricing; budgetCents: number; workerPayCents: number; feeCents: number; chargeCents: number }`, `quoteJob(input: { budgetUsd: number; title: string; instructions: string; certification_required: string | null }): JobQuote`.

- [ ] **Step 1: Write the failing test**

```ts
// services/money-verification/test/liability-pricing.test.ts
import { describe, expect, it } from 'vitest';
import { quote } from '../src/pricing.js';
import { connectorFeeCents, quoteJob } from '../src/liability/pricing.js';

describe('connectorFeeCents', () => {
  it.each([
    [2_000, 400],      // $20 -> $4.00
    [10_000, 2_000],   // $100 -> $20.00 (top of tier 1)
    [10_001, 2_000],   // 20.00 + 0.10 of a cent, rounds half-up to 2000
    [10_005, 2_001],   // 20.00 + 0.5 cent -> rounds up
    [20_000, 3_000],   // $200 -> $30.00
    [50_000, 6_000],   // $500 -> $20 + $40
    [100_000, 8_500],  // $1,000 -> $20 + $40 + $25
  ])('budget %i cents -> fee %i cents', (budget, fee) => {
    expect(connectorFeeCents(budget)).toBe(fee);
  });
  it('rejects non-positive or fractional cents', () => {
    expect(() => connectorFeeCents(0)).toThrow(RangeError);
    expect(() => connectorFeeCents(12.5)).toThrow(RangeError);
  });
});

describe('quoteJob', () => {
  it('keeps standard pricing identical to quote() for untagged jobs', () => {
    const q = quoteJob({ budgetUsd: 60, title: 'Photograph the YC sign', instructions: '', certification_required: null });
    const s = quote(6_000);
    expect(q).toMatchObject({ pricing: 'standard', budgetCents: 6_000, workerPayCents: s.workerPayCents, feeCents: s.feeCents, chargeCents: 6_000 });
  });
  it('charges the connector fee on top for a legal job; the worker keeps the whole budget', () => {
    const q = quoteJob({ budgetUsd: 200, title: 'Review our SaaS terms of service', instructions: '', certification_required: null });
    expect(q).toMatchObject({ pricing: 'connector', budgetCents: 20_000, workerPayCents: 20_000, feeCents: 3_000, chargeCents: 23_000 });
    expect(q.tags.rules).toEqual(['L2']);
  });
  it('prices a refused-tag job as standard (intake rejects it before payment)', () => {
    const q = quoteJob({ budgetUsd: 80, title: 'Rewire a kitchen outlet', instructions: '', certification_required: null });
    expect(q.tags.forced).toBe('refuse');
    expect(q.pricing).toBe('standard');
  });
  it('enforces the $20 minimum on the budget', () => {
    expect(() => quoteJob({ budgetUsd: 19.99, title: 'Notarize a deed', instructions: '', certification_required: null })).toThrow(/minimum/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/money-verification && ../../node_modules/.bin/vitest run test/liability-pricing.test.ts`
Expected: FAIL, cannot find module `../src/liability/pricing.js`.

- [ ] **Step 3: Write the implementation**

```ts
// services/money-verification/src/liability/pricing.ts
import { MIN_JOB_PRICE_CENTS, quote } from '../pricing.js';
import { tagJob, type JobTags, type Pricing } from './tags.js';

/**
 * Connector platform fee, charged to the customer on top of the budget (the licensed worker keeps the whole
 * budget): 20% of the first $100, 10% of the part from $100 to $500, 5% above $500, rounded half-up to the cent.
 */
export function connectorFeeCents(budgetCents: number): number {
  if (!Number.isInteger(budgetCents) || budgetCents <= 0) {
    throw new RangeError(`budgetCents must be a positive integer, got ${budgetCents}`);
  }
  const tier1 = Math.min(budgetCents, 10_000);
  const tier2 = Math.min(Math.max(budgetCents - 10_000, 0), 40_000);
  const tier3 = Math.max(budgetCents - 50_000, 0);
  const basisPointCents = tier1 * 2_000 + tier2 * 1_000 + tier3 * 500;
  return Math.floor((basisPointCents + 5_000) / 10_000);
}

export interface JobQuote {
  tags: JobTags;
  pricing: Pricing;
  budgetCents: number;
  workerPayCents: number;
  feeCents: number;
  /** What the customer's card is held for: always worker pay plus fee (escrowAmountCents relies on this). */
  chargeCents: number;
}

/** Intake pricing for request_human. Standard pricing is quote() unchanged. */
export function quoteJob(input: { budgetUsd: number; title: string; instructions: string; certification_required: string | null }): JobQuote {
  if (!Number.isFinite(input.budgetUsd)) throw new RangeError(`budget_usd must be a number, got ${input.budgetUsd}`);
  const budgetCents = Math.round(input.budgetUsd * 100);
  if (budgetCents < MIN_JOB_PRICE_CENTS) {
    throw new RangeError(`job price ${budgetCents} is below the ${MIN_JOB_PRICE_CENTS} cent minimum`);
  }
  const tags = tagJob(input);
  if (tags.pricing === 'connector') {
    const feeCents = connectorFeeCents(budgetCents);
    return { tags, pricing: 'connector', budgetCents, workerPayCents: budgetCents, feeCents, chargeCents: budgetCents + feeCents };
  }
  const q = quote(budgetCents);
  return { tags, pricing: 'standard', budgetCents, workerPayCents: q.workerPayCents, feeCents: q.feeCents, chargeCents: q.priceCents };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/money-verification && ../../node_modules/.bin/vitest run test/liability-pricing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/money-verification/src/liability/pricing.ts services/money-verification/test/liability-pricing.test.ts
git commit -m "money-verification: connector platform fee (sliding, charged on top) and intake quote"
```

---

### Task 3: Storage for the decision and attorney checks

**Files:**
- Create: `services/money-verification/migrations/0003_job_liability.sql`
- Modify: `services/money-verification/src/types.ts` (add `JobLiability`, widen `VerificationKind`)
- Modify: `services/money-verification/src/repo.ts` (three methods)
- Modify: `services/money-verification/src/repo/memory.ts`, `services/money-verification/src/repo/postgres.ts`
- Test: `services/money-verification/test/liability-repo.test.ts`

**Interfaces:**
- Consumes: `LiabilityModel`, `RuleId` (Task 1), `Pricing` (Task 1).
- Produces:
  - `interface JobLiability { job_id: string; tags: { rules: string[]; forced: 'connector' | 'refuse' | null }; pricing: 'standard' | 'connector'; model: 'operis' | 'connector' | 'refuse' | null; rule_id: string | null; reason: string | null; policy_version: string | null; decided_by: string | null; decided_at: Date | null; created_at: Date }`
  - `type LiabilityDecision = { model: 'operis' | 'connector' | 'refuse'; rule_id: string; reason: string; policy_version: string; decided_by: string; decided_at: Date }`
  - `Repo.getJobLiability(jobId: string): Promise<JobLiability | null>`
  - `Repo.insertJobLiability(row: Pick<JobLiability, 'job_id' | 'tags' | 'pricing'>): Promise<JobLiability>` (idempotent: an existing row is returned unchanged)
  - `Repo.decideJobLiability(jobId: string, d: LiabilityDecision): Promise<{ row: JobLiability; changed: boolean }>` (writes only when `model is null`)
  - `VerificationKind` gains `'attorney_license'`.

- [ ] **Step 1: Write the migration**

```sql
-- services/money-verification/migrations/0003_job_liability.sql
-- Per-job liability model (docs/specs/2026-11-08-liability-model-design.md). Idempotent; safe to re-run.
create table if not exists job_liability (
  job_id uuid primary key,
  tags jsonb not null default '{}'::jsonb,
  pricing text not null check (pricing in ('standard','connector')),
  model text check (model in ('operis','connector','refuse')),
  rule_id text,
  reason text,
  policy_version text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists job_liability_undecided on job_liability (created_at) where model is null;

-- Attorney licence checks join the verification kinds created in 0001.
alter table worker_verifications drop constraint if exists worker_verifications_kind_check;
alter table worker_verifications add constraint worker_verifications_kind_check
  check (kind in ('identity','notary_commission','attorney_license'));
```

- [ ] **Step 2: Write the failing test**

```ts
// services/money-verification/test/liability-repo.test.ts
import { describe, expect, it } from 'vitest';
import { InMemoryRepo } from '../src/repo/memory.js';
import { JOB_ID, T0 } from './helpers.js';

const decision = (model: 'operis' | 'connector' | 'refuse') => ({
  model, rule_id: model === 'operis' ? 'D' : 'U', reason: 'test', policy_version: '2026-11-08', decided_by: 'test', decided_at: T0,
});

describe('job_liability in the repo', () => {
  it('inserts once and returns the first row on retry', async () => {
    const repo = new InMemoryRepo();
    const a = await repo.insertJobLiability({ job_id: JOB_ID, tags: { rules: ['L2'], forced: 'connector' }, pricing: 'connector' });
    const b = await repo.insertJobLiability({ job_id: JOB_ID, tags: { rules: [], forced: null }, pricing: 'standard' });
    expect(b).toEqual(a);
    expect(a.model).toBeNull();
  });
  it('records a decision only once', async () => {
    const repo = new InMemoryRepo();
    await repo.insertJobLiability({ job_id: JOB_ID, tags: { rules: [], forced: null }, pricing: 'standard' });
    const first = await repo.decideJobLiability(JOB_ID, decision('operis'));
    const second = await repo.decideJobLiability(JOB_ID, decision('connector'));
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.row.model).toBe('operis');
    expect((await repo.getJobLiability(JOB_ID))?.decided_at).toEqual(T0);
  });
  it('returns null for an unknown job', async () => {
    expect(await new InMemoryRepo().getJobLiability(JOB_ID)).toBeNull();
  });
});
```

Add a PostgresRepo case to `test/postgres-repo.test.ts` with its existing `fakeSql` helper: answer `select * from job_liability` with one row shaped like the table (`tags` as a JSON object, `decided_at` as a string) and assert `getJobLiability` maps it to a `JobLiability` with `decided_at` a `Date`; answer the `insert into job_liability` and `update job_liability` texts and assert the SQL text contains `on conflict (job_id) do nothing` and `where job_id = $1 and model is null`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd services/money-verification && ../../node_modules/.bin/vitest run test/liability-repo.test.ts test/postgres-repo.test.ts`
Expected: FAIL, `insertJobLiability is not a function`.

- [ ] **Step 4: Add the types**

In `src/types.ts`, change `VerificationKind` and add after `WorkerVerification`:

```ts
export type VerificationKind = 'identity' | 'notary_commission' | 'attorney_license';

/** Owned by this package: the per-job liability model (src/liability, migration 0003). */
export interface JobLiability {
  job_id: string;
  tags: { rules: string[]; forced: 'connector' | 'refuse' | null };
  pricing: 'standard' | 'connector';
  model: 'operis' | 'connector' | 'refuse' | null;
  rule_id: string | null;
  reason: string | null;
  policy_version: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
}

export type LiabilityDecision = {
  model: 'operis' | 'connector' | 'refuse';
  rule_id: string;
  reason: string;
  policy_version: string;
  decided_by: string;
  decided_at: Date;
};
```

- [ ] **Step 5: Extend the Repo interface**

In `src/repo.ts`, import `JobLiability` and `LiabilityDecision` from `./types.js` and add at the end of the interface:

```ts
  // ---- job_liability (owned by this package; migration 0003) ----
  getJobLiability(jobId: string): Promise<JobLiability | null>;
  /** Intake row with tags and pricing. Idempotent: an existing row is returned unchanged. */
  insertJobLiability(row: Pick<JobLiability, 'job_id' | 'tags' | 'pricing'>): Promise<JobLiability>;
  /** Records the decision only when none is recorded; `changed` says whether this call wrote it. */
  decideJobLiability(jobId: string, d: LiabilityDecision): Promise<{ row: JobLiability; changed: boolean }>;
```

- [ ] **Step 6: Implement in InMemoryRepo**

```ts
  jobLiability = new Map<string, JobLiability>();

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
      created_at: this.now?.() ?? new Date(),
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
```

`InMemoryRepo` receives the test clock in its constructor (`new InMemoryRepo(clock.now)`); use that clock for `created_at` (replace `this.now?.()` with the field the constructor stores). Import `NotFoundError` from `../errors.js` if it is not imported yet.

- [ ] **Step 7: Implement in PostgresRepo**

Use the same private helpers `getWorkerVerification` (zero-or-one row) and `upsertWorkerVerification` (`this.one(text, params, mapper)`) use. A missing table (Postgres error `42P01`, migration 0003 not run yet) makes `getJobLiability` return null with one `console.warn`, so the API keeps working before the migration; every other error propagates.

```ts
function mapLiability(r: Row): JobLiability {
  const tags = json<{ rules?: string[]; forced?: 'connector' | 'refuse' | null }>(r.tags, {});
  return {
    job_id: String(r.job_id),
    tags: { rules: tags.rules ?? [], forced: tags.forced ?? null },
    pricing: r.pricing === 'connector' ? 'connector' : 'standard',
    model: (r.model ?? null) as JobLiability['model'],
    rule_id: r.rule_id == null ? null : String(r.rule_id),
    reason: r.reason == null ? null : String(r.reason),
    policy_version: r.policy_version == null ? null : String(r.policy_version),
    decided_by: r.decided_by == null ? null : String(r.decided_by),
    decided_at: date(r.decided_at),
    created_at: date(r.created_at) as Date,
  };
}

// inside class PostgresRepo, next to getWorkerVerification (this.one returns the mapped row or null)
  async getJobLiability(jobId: string) {
    try {
      return await this.one('select * from job_liability where job_id = $1', [jobId], mapLiability);
    } catch (e) {
      if ((e as { code?: string }).code === '42P01') {
        console.warn('[money-verification] job_liability is missing: run migration 0003');
        return null;
      }
      throw e;
    }
  }

  async insertJobLiability(row: Pick<JobLiability, 'job_id' | 'tags' | 'pricing'>) {
    const inserted = await this.one(
      `insert into job_liability (job_id, tags, pricing) values ($1, $2::jsonb, $3)
       on conflict (job_id) do nothing returning *`,
      [row.job_id, JSON.stringify(row.tags), row.pricing],
      mapLiability,
    );
    return inserted ?? (await this.getJobLiability(row.job_id))!;
  }

  async decideJobLiability(jobId: string, d: LiabilityDecision) {
    const updated = await this.one(
      `update job_liability set model = $2, rule_id = $3, reason = $4, policy_version = $5, decided_by = $6, decided_at = $7
       where job_id = $1 and model is null returning *`,
      [jobId, d.model, d.rule_id, d.reason, d.policy_version, d.decided_by, d.decided_at],
      mapLiability,
    );
    if (updated) return { row: updated, changed: true };
    const row = await this.getJobLiability(jobId);
    if (!row) throw new NotFoundError('job_liability', jobId);
    return { row, changed: false };
  }
```

`json`, `date` and `Row` are already defined in `postgres.ts`; import `NotFoundError` from `../errors.js` if the file does not yet.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd services/money-verification && ../../node_modules/.bin/tsc --noEmit && ../../node_modules/.bin/vitest run`
Expected: tsc exit 0; all tests PASS (the previous count plus the new ones).

- [ ] **Step 9: Commit**

```bash
git add services/money-verification/migrations/0003_job_liability.sql services/money-verification/src/types.ts services/money-verification/src/repo.ts services/money-verification/src/repo/memory.ts services/money-verification/src/repo/postgres.ts services/money-verification/test/liability-repo.test.ts services/money-verification/test/postgres-repo.test.ts
git commit -m "money-verification: job_liability table (migration 0003) and attorney_license verification kind"
```

---

### Task 4: Decision logic and the two agent tools

**Files:**
- Create: `services/money-verification/src/liability/decide.ts`
- Modify: `services/money-verification/src/tools/schemas.ts` (two tools), `services/money-verification/src/tools.ts` (two tools), `services/money-verification/src/index.ts` (exports)
- Test: `services/money-verification/test/liability-decide.test.ts`

**Interfaces:**
- Consumes: `RULES`, `ruleById`, `policyText`, `POLICY_VERSION`, `LiabilityModel` (Task 1); `Repo.getJobLiability`, `insertJobLiability`, `decideJobLiability`, `JobLiability` (Task 3).
- Produces:
  - `allowedModels(tags: JobLiability['tags']): LiabilityModel[]`
  - `getLiabilityContext(deps: LiabilityDeps, jobId: string): Promise<LiabilityContext>` where `LiabilityContext = { job_id; pricing; tags; decision: { model; rule_id; reason; decided_by; decided_at: string } | null; allowed_models: LiabilityModel[]; policy_version: string; policy: string }`
  - `setLiability(deps, input: { jobId: string; model: LiabilityModel; ruleId: string; reason: string; decidedBy: string }): Promise<{ liability: JobLiability; next: 'wake_ceo' | 'cancel'; changed: boolean }>`
  - `decideFallback(deps, jobId: string): Promise<{ liability: JobLiability; next: 'wake_ceo' | 'cancel'; changed: boolean }>`
  - `interface LiabilityDeps { repo: Pick<Repo, 'getJobLiability' | 'insertJobLiability' | 'decideJobLiability'>; now?: () => Date }`
  - tools `get_liability_context { job_id }` and `set_liability { job_id, model, rule_id, reason }` in `createTools`, output `{ job_id, model, rule_id, reason, next, changed }`.

Rules enforced by `setLiability` (each with its own test):
1. `rule_id` must exist in the policy, else `InvalidStateError('unknown_rule: ...')`.
2. `model` must be in `allowedModels(tags)`: forced refuse → `['refuse']`; forced connector → `['connector', 'refuse']`; none → all three. Else `InvalidStateError('model_not_allowed: ...')`.
3. `model` must match the rule: `rule.model === model`, except that `refuse` may cite `L1` or `L2` when the job was priced `standard` (the re-post case). Else `InvalidStateError('rule_mismatch: ...')`.
4. `connector` citing `L1` or `L2` on a job priced `standard` is refused with `InvalidStateError('repost_required: this job was priced as a standard job; refuse it with rule L1 or L2 and tell the customer to post it again as a notary or legal job so it is priced as one')`.
5. A job with no intake row (created before this shipped) gets one first, with no tags and `standard` pricing.
6. Once decided, the same decision again returns `changed: false`; a different one throws `InvalidStateError('already_decided: ...')`.
7. `reason` is trimmed and must be 1 to 500 characters (zod in the tool schema).

`decideFallback`: forced refuse → `refuse` with the first refusing rule in `tags.rules`; forced connector → `connector` with the first connector rule in `tags.rules`; no tags → `connector` with `U`. Reason `no decision within fifteen minutes`, `decidedBy` `fallback`. Already decided → returns the stored decision with `changed: false`.

- [ ] **Step 1: Write the failing test**

```ts
// services/money-verification/test/liability-decide.test.ts
import { describe, expect, it } from 'vitest';
import { InMemoryRepo } from '../src/repo/memory.js';
import { allowedModels, decideFallback, getLiabilityContext, setLiability } from '../src/liability/decide.js';
import { JOB_ID, T0 } from './helpers.js';

const deps = (repo = new InMemoryRepo()) => ({ repo, now: () => T0 });
const seed = async (repo: InMemoryRepo, rules: string[], forced: 'connector' | 'refuse' | null, pricing: 'standard' | 'connector') =>
  repo.insertJobLiability({ job_id: JOB_ID, tags: { rules, forced }, pricing });
const set = (d: ReturnType<typeof deps>, model: 'operis' | 'connector' | 'refuse', ruleId: string, reason = 'per policy') =>
  setLiability(d, { jobId: JOB_ID, model, ruleId, reason, decidedBy: 'compliance-agent' });

describe('allowedModels', () => {
  it('follows the forced tag', () => {
    expect(allowedModels({ rules: ['L3'], forced: 'refuse' })).toEqual(['refuse']);
    expect(allowedModels({ rules: ['L2'], forced: 'connector' })).toEqual(['connector', 'refuse']);
    expect(allowedModels({ rules: [], forced: null })).toEqual(['operis', 'connector', 'refuse']);
  });
});

describe('setLiability', () => {
  it('records operis under D and asks to wake the CEO', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    const out = await set(d, 'operis', 'D');
    expect(out).toMatchObject({ next: 'wake_ceo', changed: true, liability: { model: 'operis', rule_id: 'D', policy_version: '2026-11-08', decided_by: 'compliance-agent', decided_at: T0 } });
  });
  it('records connector under L2 on a connector-priced job', async () => {
    const d = deps(); await seed(d.repo, ['L2'], 'connector', 'connector');
    expect((await set(d, 'connector', 'L2')).liability.model).toBe('connector');
  });
  it('asks to cancel on refuse', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    expect((await set(d, 'refuse', 'R', 'surveillance of a person')).next).toBe('cancel');
  });
  it('rejects an unknown rule', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    await expect(set(d, 'operis', 'Z9')).rejects.toThrow(/^unknown_rule/);
  });
  it('never lets the agent overrule a forced tag', async () => {
    const d = deps(); await seed(d.repo, ['L2'], 'connector', 'connector');
    await expect(set(d, 'operis', 'D')).rejects.toThrow(/^model_not_allowed/);
  });
  it('rejects a model that does not match the rule', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    await expect(set(d, 'operis', 'U')).rejects.toThrow(/^rule_mismatch/);
  });
  it('requires a re-post when L1/L2 work arrives priced as standard', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    await expect(set(d, 'connector', 'L2')).rejects.toThrow(/^repost_required/);
    expect((await set(d, 'refuse', 'L2', 'legal work priced as standard; re-post as a legal job')).next).toBe('cancel');
  });
  it('creates the intake row for a job created before this shipped', async () => {
    const d = deps();
    expect((await set(d, 'operis', 'D')).liability.pricing).toBe('standard');
  });
  it('is idempotent for the same decision and refuses a different one', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    await set(d, 'operis', 'D');
    expect((await set(d, 'operis', 'D')).changed).toBe(false);
    await expect(set(d, 'connector', 'U')).rejects.toThrow(/^already_decided/);
  });
});

describe('decideFallback', () => {
  it.each([
    [['L3'], 'refuse', 'standard', 'refuse', 'L3', 'cancel'],
    [['L1'], 'connector', 'connector', 'connector', 'L1', 'wake_ceo'],
    [[], null, 'standard', 'connector', 'U', 'wake_ceo'],
  ] as const)('tags %j -> %s', async (rules, forced, pricing, model, rule, next) => {
    const d = deps(); await seed(d.repo, [...rules], forced, pricing);
    const out = await decideFallback(d, JOB_ID);
    expect(out).toMatchObject({ next, changed: true, liability: { model, rule_id: rule, decided_by: 'fallback', reason: 'no decision within fifteen minutes' } });
  });
  it('leaves an existing decision alone', async () => {
    const d = deps(); await seed(d.repo, [], null, 'standard');
    await set(d, 'operis', 'D');
    expect((await decideFallback(d, JOB_ID)).changed).toBe(false);
  });
});

describe('getLiabilityContext', () => {
  it('returns tags, pricing, allowed models and the full policy text', async () => {
    const d = deps(); await seed(d.repo, ['L2'], 'connector', 'connector');
    const ctx = await getLiabilityContext(d, JOB_ID);
    expect(ctx).toMatchObject({ job_id: JOB_ID, pricing: 'connector', allowed_models: ['connector', 'refuse'], decision: null, policy_version: '2026-11-08' });
    expect(ctx.policy).toContain('L2 Legal services');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/money-verification && ../../node_modules/.bin/vitest run test/liability-decide.test.ts`
Expected: FAIL, cannot find module `../src/liability/decide.js`.

- [ ] **Step 3: Write the implementation**

```ts
// services/money-verification/src/liability/decide.ts
import { InvalidStateError } from '../errors.js';
import type { Repo } from '../repo.js';
import type { JobLiability } from '../types.js';
import { POLICY_VERSION, RULES, policyText, ruleById, type LiabilityModel } from './policy.js';

export interface LiabilityDeps {
  repo: Pick<Repo, 'getJobLiability' | 'insertJobLiability' | 'decideJobLiability'>;
  now?: () => Date;
}

export interface LiabilityContext {
  job_id: string;
  pricing: JobLiability['pricing'];
  tags: JobLiability['tags'];
  decision: { model: string; rule_id: string | null; reason: string | null; decided_by: string | null; decided_at: string | null } | null;
  allowed_models: LiabilityModel[];
  policy_version: string;
  policy: string;
}

export interface DecisionOutcome {
  liability: JobLiability;
  /** What the API does next: wake the CEO to dispatch, or release the hold and cancel the job. */
  next: 'wake_ceo' | 'cancel';
  changed: boolean;
}

export function allowedModels(tags: JobLiability['tags']): LiabilityModel[] {
  if (tags.forced === 'refuse') return ['refuse'];
  if (tags.forced === 'connector') return ['connector', 'refuse'];
  return ['operis', 'connector', 'refuse'];
}

async function intakeRow(deps: LiabilityDeps, jobId: string): Promise<JobLiability> {
  return (await deps.repo.getJobLiability(jobId))
    ?? deps.repo.insertJobLiability({ job_id: jobId, tags: { rules: [], forced: null }, pricing: 'standard' });
}

const nextFor = (model: LiabilityModel): DecisionOutcome['next'] => (model === 'refuse' ? 'cancel' : 'wake_ceo');

export async function getLiabilityContext(deps: LiabilityDeps, jobId: string): Promise<LiabilityContext> {
  const row = await intakeRow(deps, jobId);
  return {
    job_id: jobId,
    pricing: row.pricing,
    tags: row.tags,
    decision: row.model
      ? { model: row.model, rule_id: row.rule_id, reason: row.reason, decided_by: row.decided_by, decided_at: row.decided_at?.toISOString() ?? null }
      : null,
    allowed_models: allowedModels(row.tags),
    policy_version: POLICY_VERSION,
    policy: policyText(),
  };
}

export async function setLiability(
  deps: LiabilityDeps,
  input: { jobId: string; model: LiabilityModel; ruleId: string; reason: string; decidedBy: string },
): Promise<DecisionOutcome> {
  const row = await intakeRow(deps, input.jobId);
  const rule = ruleById(input.ruleId);
  if (!rule) throw new InvalidStateError(`unknown_rule: ${input.ruleId} is not in liability policy ${POLICY_VERSION}`);
  const allowed = allowedModels(row.tags);
  if (!allowed.includes(input.model)) {
    throw new InvalidStateError(`model_not_allowed: intake tags ${JSON.stringify(row.tags.rules)} allow only ${allowed.join(' or ')}`);
  }
  const licensed = rule.id === 'L1' || rule.id === 'L2';
  if (input.model === 'connector' && licensed && row.pricing === 'standard') {
    throw new InvalidStateError(
      'repost_required: this job was priced as a standard job; refuse it with rule L1 or L2 and tell the customer to post it again as a notary or legal job so it is priced as one',
    );
  }
  const repostRefusal = input.model === 'refuse' && licensed && row.pricing === 'standard';
  if (rule.model !== input.model && !repostRefusal) {
    throw new InvalidStateError(`rule_mismatch: rule ${rule.id} (${rule.title}) means ${rule.model}, not ${input.model}`);
  }
  const reason = input.reason.trim();
  const { row: stored, changed } = await deps.repo.decideJobLiability(input.jobId, {
    model: input.model,
    rule_id: rule.id,
    reason,
    policy_version: POLICY_VERSION,
    decided_by: input.decidedBy,
    decided_at: deps.now?.() ?? new Date(),
  });
  if (!changed && (stored.model !== input.model || stored.rule_id !== rule.id)) {
    throw new InvalidStateError(`already_decided: job ${input.jobId} is ${stored.model} under ${stored.rule_id} (${stored.reason})`);
  }
  return { liability: stored, next: nextFor(stored.model as LiabilityModel), changed };
}

export async function decideFallback(deps: LiabilityDeps, jobId: string): Promise<DecisionOutcome> {
  const row = await intakeRow(deps, jobId);
  if (row.model) return { liability: row, next: nextFor(row.model), changed: false };
  const firstOf = (model: LiabilityModel) => RULES.find((r) => r.model === model && row.tags.rules.includes(r.id))?.id;
  const [model, ruleId] =
    row.tags.forced === 'refuse' ? (['refuse', firstOf('refuse') ?? 'R'] as const)
    : row.tags.forced === 'connector' ? (['connector', firstOf('connector') ?? 'U'] as const)
    : (['connector', 'U'] as const);
  return setLiability(deps, { jobId, model, ruleId, reason: 'no decision within fifteen minutes', decidedBy: 'fallback' });
}
```

- [ ] **Step 4: Add the tool schemas and tools**

In `src/tools/schemas.ts`, next to `check_eligibility` (reuse the file's `uuid` helper):

```ts
  get_liability_context: {
    description: 'Compliance: the job\'s intake tags, pricing, allowed models, any recorded decision, and the full liability policy text. Read the job itself with get_job.',
    input: z.object({ job_id: uuid }).strict(),
    output: z.object({
      job_id: z.string(), pricing: z.enum(['standard', 'connector']),
      tags: z.object({ rules: z.array(z.string()), forced: z.enum(['connector', 'refuse']).nullable() }),
      decision: z.object({ model: z.string(), rule_id: z.string().nullable(), reason: z.string().nullable(), decided_by: z.string().nullable(), decided_at: z.string().nullable() }).nullable(),
      allowed_models: z.array(z.enum(['operis', 'connector', 'refuse'])), policy_version: z.string(), policy: z.string(),
    }),
  },
  set_liability: {
    description: 'Compliance: record the job\'s liability model (operis, connector or refuse) with the policy rule id and a one-line reason. Final once recorded.',
    input: z.object({ job_id: uuid, model: z.enum(['operis', 'connector', 'refuse']), rule_id: z.string().min(1).max(4), reason: z.string().trim().min(1).max(500) }).strict(),
    output: z.object({ job_id: z.string(), model: z.enum(['operis', 'connector', 'refuse']), rule_id: z.string(), reason: z.string(), next: z.enum(['wake_ceo', 'cancel']), changed: z.boolean() }),
  },
```

In `src/tools.ts`, inside `createTools`, next to `check_eligibility`:

```ts
    async get_liability_context(raw) {
      const { job_id } = parse('get_liability_context', raw);
      return getLiabilityContext({ repo: deps.repo, now: deps.now }, job_id);
    },
    async set_liability(raw) {
      const { job_id, model, rule_id, reason } = parse('set_liability', raw);
      const out = await setLiability({ repo: deps.repo, now: deps.now }, { jobId: job_id, model, ruleId: rule_id, reason, decidedBy: 'compliance-agent' });
      return { job_id, model: out.liability.model!, rule_id: out.liability.rule_id!, reason: out.liability.reason!, next: out.next, changed: out.changed };
    },
```

Import `getLiabilityContext` and `setLiability` from `./liability/decide.js`. If `describeToolError` (in `src/tools.ts`) maps `InvalidStateError` messages to codes by prefix, add the prefixes `unknown_rule`, `model_not_allowed`, `rule_mismatch`, `repost_required`, `already_decided` so agents see them as codes.

In `src/index.ts` add:

```ts
export * from './liability/policy.js';
export * from './liability/tags.js';
export * from './liability/pricing.js';
export * from './liability/decide.js';
```

- [ ] **Step 5: Add tool-level tests**

```ts
// append to test/liability-decide.test.ts
import { createTools } from '../src/tools.js';
import { makeWorld } from './helpers.js';

describe('liability tools', () => {
  it('set_liability trims the reason and reports what happens next', async () => {
    const world = makeWorld();
    const tools = createTools(world.deps);
    const out = await tools.set_liability({ job_id: JOB_ID, model: 'operis', rule_id: 'D', reason: '  photo job, no licence  ' });
    expect(out).toEqual({ job_id: JOB_ID, model: 'operis', rule_id: 'D', reason: 'photo job, no licence', next: 'wake_ceo', changed: true });
  });
  it('set_liability rejects an empty reason', async () => {
    const tools = createTools(makeWorld().deps);
    await expect(tools.set_liability({ job_id: JOB_ID, model: 'operis', rule_id: 'D', reason: '' })).rejects.toThrow();
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd services/money-verification && ../../node_modules/.bin/tsc --noEmit && ../../node_modules/.bin/vitest run`
Expected: tsc exit 0; all PASS.

- [ ] **Step 7: Commit**

```bash
git add services/money-verification/src/liability/decide.ts services/money-verification/src/tools/schemas.ts services/money-verification/src/tools.ts services/money-verification/src/index.ts services/money-verification/test/liability-decide.test.ts
git commit -m "money-verification: liability decision with guardrails, fallback, and get_liability_context / set_liability tools"
```

---

### Task 5: Attorney licence check against the State Bar

**Files:**
- Create: `services/money-verification/src/certs/attorney.ts`
- Create: `services/money-verification/test/fixtures/calbar-active.html`, `calbar-inactive.html` (synthetic)
- Modify: `services/money-verification/src/tools/schemas.ts`, `src/tools.ts` (tool `verify_attorney`), `src/index.ts`
- Test: `services/money-verification/test/attorney.test.ts`

**Interfaces:**
- Consumes: `matchNames(given, onRecord): { match: 'full' | 'partial' | 'none'; reason: string }` from `src/certs/names.ts`; `Repo.upsertWorkerVerification`, `getWorkerVerification`.
- Produces: `type FetchText = (url: string) => Promise<{ status: number; body: string }>`, `parseCalBarProfile(html: string): { name: string | null; status: string | null }`, `verifyAttorney(deps: { repo: Pick<Repo, 'upsertWorkerVerification'>; fetchText?: FetchText; now?: () => Date }, input: { workerId: string; barNumber: string; name: string }): Promise<{ status: 'verified' | 'needs_review' | 'failed'; reasons: string[]; name_on_record: string | null; licence_status: string | null }>`, tool `verify_attorney { worker_id, bar_number, name }`.

- [ ] **Step 1: Learn the page, then write synthetic fixtures**

Fetch the public search page once to see the markup of a licensee profile (do not save any real person's page in the repo):

```bash
curl -s -A "operis-licence-check/0.1" "https://apps.calbar.ca.gov/attorney/LicenseeSearch/QuickSearch" | head -c 3000
```

Open one licensee detail page in a browser from a public search, note how the name with `#<number>` and the `License Status` value appear, then write two synthetic fixtures with the same markup, an invented name `Jordan Q. Example` and the invented number `999001`: `calbar-active.html` with status `Active` and `calbar-inactive.html` with status `Inactive`. If the real markup differs from the regexes in Step 3, change the regexes and say so in the commit message.

- [ ] **Step 2: Write the failing test**

```ts
// services/money-verification/test/attorney.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCalBarProfile, verifyAttorney } from '../src/certs/attorney.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import { T0, WORKER_ID } from './helpers.js';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const page = (body: string, status = 200) => async () => ({ status, body });

describe('parseCalBarProfile', () => {
  it('reads the name and the licence status', () => {
    expect(parseCalBarProfile(fixture('calbar-active.html'))).toEqual({ name: 'Jordan Q. Example', status: 'Active' });
    expect(parseCalBarProfile(fixture('calbar-inactive.html')).status).toBe('Inactive');
    expect(parseCalBarProfile('<html>nothing here</html>')).toEqual({ name: null, status: null });
  });
});

describe('verifyAttorney', () => {
  const run = (fetchText: () => Promise<{ status: number; body: string }>, name = 'Jordan Example', barNumber = '999001') => {
    const repo = new InMemoryRepo();
    return { repo, out: verifyAttorney({ repo, fetchText, now: () => T0 }, { workerId: WORKER_ID, barNumber, name }) };
  };
  it('verifies an active licence with a matching name and stores it for thirty days', async () => {
    const { repo, out } = run(page(fixture('calbar-active.html')));
    expect(await out).toMatchObject({ status: 'verified', reasons: [], licence_status: 'Active' });
    const v = await repo.getWorkerVerification(WORKER_ID, 'attorney_license');
    expect(v).toMatchObject({ status: 'verified', provider_ref: '999001' });
    expect(v?.expires_at?.getTime()).toBe(T0.getTime() + 30 * 24 * 3600 * 1000);
  });
  it('fails an inactive licence', async () => {
    expect(await run(page(fixture('calbar-inactive.html'))).out).toMatchObject({ status: 'failed', reasons: ['licence_not_active: Inactive'] });
  });
  it('fails a name that does not match', async () => {
    expect(await run(page(fixture('calbar-active.html')), 'Someone Else').out).toMatchObject({ status: 'failed', reasons: ['name_mismatch'] });
  });
  it('fails an unknown number and an invalid one without fetching', async () => {
    expect(await run(page('', 404)).out).toMatchObject({ status: 'failed', reasons: ['not_found'] });
    let fetched = false;
    expect(await run(async () => { fetched = true; return { status: 200, body: '' }; }, 'Jordan Example', 'abc').out)
      .toMatchObject({ status: 'failed', reasons: ['invalid_bar_number'] });
    expect(fetched).toBe(false);
  });
  it('needs review when the lookup is unreachable, and stores nothing verified', async () => {
    const { repo, out } = run(async () => { throw new Error('ECONNRESET'); });
    expect(await out).toMatchObject({ status: 'needs_review', reasons: ['lookup_unavailable'] });
    expect((await repo.getWorkerVerification(WORKER_ID, 'attorney_license'))?.status).not.toBe('verified');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/money-verification && ../../node_modules/.bin/vitest run test/attorney.test.ts`
Expected: FAIL, cannot find module `../src/certs/attorney.js`.

- [ ] **Step 4: Write the implementation**

```ts
// services/money-verification/src/certs/attorney.ts
// California State Bar licence check for connector legal jobs (policy rule L2). Reads the public licensee
// profile page; robots.txt allowed /attorney/ paths when this was written (2026-11-08). Not legal advice.
import type { Repo } from '../repo.js';
import { matchNames } from './names.js';

export type FetchText = (url: string) => Promise<{ status: number; body: string }>;

const PROFILE_URL = (n: string) => `https://apps.calbar.ca.gov/attorney/Licensee/Detail/${n}`;
const RECHECK_MS = 30 * 24 * 3600 * 1000;

const defaultFetch: FetchText = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'operis-licence-check/0.1' }, redirect: 'manual' });
  return { status: res.status, body: res.status === 200 ? await res.text() : '' };
};

const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');

export function parseCalBarProfile(html: string): { name: string | null; status: string | null } {
  const t = text(html);
  const name = /([A-Z][A-Za-z.'\- ]+?)\s*#\s*\d{1,7}\b/.exec(t)?.[1]?.trim() ?? null;
  const status = /License Status:?\s*([A-Za-z][A-Za-z ]*?)(?=\s{1,}[A-Z][a-z]+:|$)/.exec(t)?.[1]?.trim() ?? null;
  return { name, status };
}

export async function verifyAttorney(
  deps: { repo: Pick<Repo, 'upsertWorkerVerification'>; fetchText?: FetchText; now?: () => Date },
  input: { workerId: string; barNumber: string; name: string },
): Promise<{ status: 'verified' | 'needs_review' | 'failed'; reasons: string[]; name_on_record: string | null; licence_status: string | null }> {
  const now = deps.now?.() ?? new Date();
  const barNumber = input.barNumber.trim();
  const done = async (status: 'verified' | 'needs_review' | 'failed', reasons: string[], name_on_record: string | null, licence_status: string | null) => {
    await deps.repo.upsertWorkerVerification({
      worker_id: input.workerId, kind: 'attorney_license', status, provider_ref: barNumber || null,
      details: { name_on_record, licence_status, reasons, source: barNumber ? PROFILE_URL(barNumber) : null, checked_at: now.toISOString() },
      verified_at: status === 'verified' ? now : null,
      expires_at: status === 'verified' ? new Date(now.getTime() + RECHECK_MS) : null,
    });
    return { status, reasons, name_on_record, licence_status };
  };
  if (!/^\d{1,7}$/.test(barNumber)) return done('failed', ['invalid_bar_number'], null, null);
  let page: { status: number; body: string };
  try {
    page = await (deps.fetchText ?? defaultFetch)(PROFILE_URL(barNumber));
  } catch {
    return done('needs_review', ['lookup_unavailable'], null, null);
  }
  if (page.status !== 200) return done('failed', ['not_found'], null, null);
  const { name, status } = parseCalBarProfile(page.body);
  if (!name || !status) return done('needs_review', ['profile_unreadable'], name, status);
  if (status.toLowerCase() !== 'active') return done('failed', [`licence_not_active: ${status}`], name, status);
  const m = matchNames(input.name, name);
  if (m.match === 'full') return done('verified', [], name, status);
  if (m.match === 'partial') return done('needs_review', [`name_partial_match: ${m.reason}`], name, status);
  return done('failed', ['name_mismatch'], name, status);
}
```

In `src/tools/schemas.ts`, next to `verify_notary`:

```ts
  verify_attorney: {
    description: 'Check a worker\'s California State Bar licence (connector legal jobs, policy L2): active status and a matching name.',
    input: z.object({ worker_id: uuid, bar_number: z.string().min(1).max(10), name: z.string().min(2).max(200) }).strict(),
    output: z.object({
      status: z.enum(['verified', 'needs_review', 'failed']), reasons: z.array(z.string()),
      name_on_record: z.string().nullable(), licence_status: z.string().nullable(),
    }),
  },
```

In `src/tools.ts`, next to `verify_notary`:

```ts
    async verify_attorney(raw) {
      const { worker_id, bar_number, name } = parse('verify_attorney', raw);
      return verifyAttorney({ repo: deps.repo, now: deps.now }, { workerId: worker_id, barNumber: bar_number, name });
    },
```

Import `verifyAttorney` from `./certs/attorney.js`, and add `export * from './certs/attorney.js';` to `src/index.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/money-verification && ../../node_modules/.bin/tsc --noEmit && ../../node_modules/.bin/vitest run`
Expected: tsc exit 0; all PASS.

- [ ] **Step 6: One live read, then commit**

Run one live check against a bar number from a public profile you looked at in Step 1, from a scratch script (never committed), and paste the parsed `{ name, status }` into the commit message with the name redacted to initials.

```bash
git add services/money-verification/src/certs/attorney.ts services/money-verification/test/attorney.test.ts services/money-verification/test/fixtures/calbar-active.html services/money-verification/test/fixtures/calbar-inactive.html services/money-verification/src/tools/schemas.ts services/money-verification/src/tools.ts services/money-verification/src/index.ts
git commit -m "money-verification: State Bar licence check (verify_attorney) for connector legal jobs"
```

---

### Task 6: Licences required before accept

**Files:**
- Modify: `services/money-verification/src/eligibility.ts`
- Test: `services/money-verification/test/eligibility.test.ts` (extend; create it if eligibility tests live elsewhere, check `grep -l checkEligibility test/`)

**Interfaces:**
- Consumes: `Repo.getJobLiability` (Task 3), verification kind `attorney_license` (Task 3/5).
- Produces: `checkEligibility` now also requires, by intake tag, a verified notary commission for `L1` (even when `task_type` is not `notarization`) and a verified, unexpired `attorney_license` for `L2`. Reason strings: `notary_not_verified: ...`, `notary_commission_expires_before_deadline`, `attorney_not_verified: ...`, `attorney_check_expires_before_deadline`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to the eligibility tests
import { checkEligibility } from '../src/eligibility.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import { JOB_ID, T0, WORKER_ID, makeJob, makeWorker } from './helpers.js';

describe('licences required by the liability tags', () => {
  const setup = async (rules: string[]) => {
    const repo = new InMemoryRepo();
    repo.seedJob(makeJob({ status: 'outreach', worker_id: null }));
    repo.seedWorker(makeWorker());
    await repo.insertJobLiability({ job_id: JOB_ID, tags: { rules, forced: 'connector' }, pricing: 'connector' });
    return repo;
  };
  it('refuses an L2 job without a verified attorney licence', async () => {
    const repo = await setup(['L2']);
    const r = await checkEligibility({ repo }, { workerId: WORKER_ID, jobId: JOB_ID });
    expect(r.eligible).toBe(false);
    expect(r.reasons.some((x) => x.startsWith('attorney_not_verified'))).toBe(true);
  });
  it('accepts an L2 job with a verified attorney licence that outlasts the deadline', async () => {
    const repo = await setup(['L2']);
    await repo.upsertWorkerVerification({ worker_id: WORKER_ID, kind: 'attorney_license', status: 'verified', provider_ref: '999001', details: {}, verified_at: T0, expires_at: new Date(T0.getTime() + 30 * 24 * 3600 * 1000) });
    const r = await checkEligibility({ repo }, { workerId: WORKER_ID, jobId: JOB_ID });
    expect(r.reasons.filter((x) => x.startsWith('attorney'))).toEqual([]);
  });
  it('requires a notary commission for an L1 tag even when task_type is not notarization', async () => {
    const repo = await setup(['L1']);
    const r = await checkEligibility({ repo }, { workerId: WORKER_ID, jobId: JOB_ID });
    expect(r.reasons.some((x) => x.startsWith('notary_not_verified'))).toBe(true);
  });
  it('changes nothing for a job without tags', async () => {
    const repo = new InMemoryRepo();
    repo.seedJob(makeJob({ status: 'outreach', worker_id: null }));
    repo.seedWorker(makeWorker());
    expect((await checkEligibility({ repo }, { workerId: WORKER_ID, jobId: JOB_ID })).eligible).toBe(true);
  });
});
```

Use the seeding helpers the repo actually has (`seedJob` exists; check the worker seeder's name in `src/repo/memory.ts` and use it).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/money-verification && ../../node_modules/.bin/vitest run test/eligibility.test.ts`
Expected: FAIL on the L2 and L1 cases.

- [ ] **Step 3: Implement**

In `src/eligibility.ts`, widen the deps pick to `Pick<Repo, 'getJob' | 'getWorker' | 'getWorkerVerification' | 'getJobLiability'>`, replace the notary block with one licence helper, and add the L2 check:

```ts
  const rules = (await deps.repo.getJobLiability(job.id))?.tags.rules ?? [];
  const licence = async (kind: 'notary_commission' | 'attorney_license', label: 'notary' | 'attorney', missing: string) => {
    const v = await deps.repo.getWorkerVerification(worker.id, kind);
    if (!v || v.status !== 'verified') reasons.push(`${label}_not_verified: ${v?.status ?? missing}`);
    else if (v.expires_at && v.expires_at.getTime() < job.deadline.getTime()) {
      reasons.push(label === 'notary' ? 'notary_commission_expires_before_deadline' : 'attorney_check_expires_before_deadline');
    }
  };
  if (job.task_type === 'notarization' || rules.includes('L1')) await licence('notary_commission', 'notary', 'no verification on file');
  if (rules.includes('L2')) await licence('attorney_license', 'attorney', 'no State Bar check on file (verify with your bar number)');
```

Keep the identity block exactly as it is (PR #30 may have changed it; do not touch its lines).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/money-verification && ../../node_modules/.bin/tsc --noEmit && ../../node_modules/.bin/vitest run`
Expected: tsc exit 0; all PASS (the existing notary eligibility tests must still pass unchanged).

- [ ] **Step 5: Commit**

```bash
git add services/money-verification/src/eligibility.ts services/money-verification/test/eligibility.test.ts
git commit -m "money-verification: eligibility requires the licence the liability tags name (L1 notary, L2 attorney)"
```

---

### Task 7: The compliance shim for the API

**Files:**
- Create: `services/compliance/index.ts`
- Modify: your scratch shim tsconfig (add the new file)

**Interfaces:**
- Consumes: `quoteJob`, `JobQuote`, `ruleById`, `decideFallback`, `checkEligibility`, `verifyAttorney`, `verifyNotary`, `releaseEscrow`, `createTools`, `depsFromApiContext`, `depsFromProcessEnv`, `ApiContext` from `services/money-verification/src/index`.
- Produces (named exports, read by Edwin's code with `import * as compliance from "@services/compliance/index"`):
  - `quoteJob(input): JobQuote` (re-export)
  - `refusalReason(ruleId: string): string`
  - `recordIntake(jobId: string, q: JobQuote): Promise<void>`
  - `LIABILITY_TOOLS: { get_liability_context(args, ctx); set_liability(args, ctx) }`
  - `fallbackDecision(jobId: string): Promise<{ model: string; rule_id: string; reason: string; next: 'wake_ceo' | 'cancel'; changed: boolean }>`
  - `hasDecision(jobId: string): Promise<boolean>`
  - `releaseHold(jobId: string, reason: string): Promise<void>`
  - `eligibilityForAccept(workerId: string, jobId: string): Promise<{ eligible: boolean; reasons: string[] }>`
  - `verifyLicence(input: { workerId: string; jobId: string; kind: 'notary' | 'attorney'; number: string; name: string }): Promise<{ status: string; reasons: string[] }>`

- [ ] **Step 1: Write the shim**

```ts
// services/compliance/index.ts
// Cameron: the per-job liability model for apps/api (docs/specs/2026-11-08-liability-model-design.md).
// Logic lives in services/money-verification (src/liability, src/certs/attorney.ts); this file binds it to the API.
import type { ToolContext } from "../../contracts/runtime";
import {
  checkEligibility,
  createTools,
  decideFallback,
  depsFromApiContext,
  depsFromProcessEnv,
  quoteJob,
  releaseEscrow,
  ruleById,
  verifyAttorney,
  verifyNotary,
  type ApiContext,
  type JobQuote,
} from "../money-verification/src/index";

export { quoteJob };
export type { JobQuote };

/** The customer-facing reason for a job whose intake tags force a refusal (L3 to L6). */
export function refusalReason(ruleId: string): string {
  const rule = ruleById(ruleId);
  return `We can't take this job yet: ${rule ? rule.title.toLowerCase() : "this kind of work"} needs a licence we can't verify (policy ${ruleId}).`;
}

/** request_human: store the intake tags and pricing next to the new job. */
export async function recordIntake(jobId: string, q: JobQuote): Promise<void> {
  await depsFromProcessEnv().repo.insertJobLiability({ job_id: jobId, tags: { rules: q.tags.rules, forced: q.tags.forced }, pricing: q.pricing });
}

const tools = (ctx: ToolContext) => createTools(depsFromApiContext(ctx as ApiContext) as any) as any;

/** Internal MCP tools for the Compliance agent; validation happens inside createTools. */
export const LIABILITY_TOOLS = {
  get_liability_context: (args: unknown, ctx: ToolContext) => tools(ctx).get_liability_context(args),
  set_liability: (args: unknown, ctx: ToolContext) => tools(ctx).set_liability(args),
};

/** The sweep's fifteen-minute fallback. */
export async function fallbackDecision(jobId: string) {
  const out = await decideFallback(depsFromProcessEnv(), jobId);
  return { model: out.liability.model!, rule_id: out.liability.rule_id!, reason: out.liability.reason!, next: out.next, changed: out.changed };
}

/** The Ops gate: find_people / send_blast wait for a decision. */
export async function hasDecision(jobId: string): Promise<boolean> {
  return Boolean((await depsFromProcessEnv().repo.getJobLiability(jobId))?.model);
}

/** A refused job: cancel the card authorization (nothing was captured) before the job moves to cancelled. */
export async function releaseHold(jobId: string, reason: string): Promise<void> {
  try {
    await releaseEscrow(depsFromProcessEnv(), jobId, reason);
  } catch (e) {
    // No escrow means nothing was held (MOCK_PAYMENTS jobs); anything else must surface.
    if ((e as { name?: string }).name !== "NotFoundError") throw e;
  }
}

/** acceptJob's gate. */
export async function eligibilityForAccept(workerId: string, jobId: string) {
  const r = await checkEligibility(depsFromProcessEnv(), { workerId, jobId });
  return { eligible: r.eligible, reasons: r.reasons };
}

/** POST /v1/worker/license: the worker proves the licence a connector job needs. */
export async function verifyLicence(input: { workerId: string; jobId: string; kind: "notary" | "attorney"; number: string; name: string }) {
  const deps = depsFromProcessEnv();
  if (input.kind === "attorney") return verifyAttorney(deps, { workerId: input.workerId, barNumber: input.number, name: input.name });
  const job = await deps.repo.getJob(input.jobId);
  return verifyNotary(deps, { workerId: input.workerId, commissionNumber: input.number, name: input.name, jobDate: job?.deadline ?? new Date() });
}
```

`releaseEscrow(deps, jobId, reason)` in `src/escrow.ts` returns early for an already released escrow and throws `NotFoundError` when there is none; confirm that `NotFoundError` sets `name` to `'NotFoundError'` (or import the class and use `instanceof`).

- [ ] **Step 2: Typecheck the shims**

Add `services/compliance/index.ts` to your bundler-resolution shim tsconfig and run it.
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add services/compliance/index.ts
git commit -m "services/compliance: liability shim for the API (intake quote, agent tools, fallback, accept gate, licence check)"
```

---

### Task 8: Intake: pricing, tags, refusal, and get_job fields

**Files:**
- Modify: `apps/api/src/tools/edwin.ts` (`requestHuman`, `getJob`)
- Modify: `apps/api/src/lib/safety.ts`

**Interfaces:**
- Consumes: `quoteJob`, `recordIntake`, `refusalReason` (Task 7).
- Produces: `request_human` returns `quote_usd` = the amount held (worker pay + fee); rejects L3 to L6 jobs before payment; `get_job` adds `liability_model`, `liability_reason`, `pricing` and `charge_usd`.

- [ ] **Step 1: Split the intake filter**

In `apps/api/src/lib/safety.ts`, keep the rule's `category` id `licensed_dangerous` (callers and tests may match on it; grep first), drop the licensed-work patterns now handled by the policy, and keep the dangerous ones:

```ts
  {
    category: "licensed_dangerous",
    reason: "We don't take dangerous or medical work (medical advice or procedures, prescriptions, driving passengers, weapons, drugs).",
    patterns: [/\b(medical (advice|procedure)|prescri|drive (me|passengers)|rideshare|weapon|firearm|drugs?)\b/i],
  },
```

If an `apps/api` test asserts that "electrical wiring" or "legal advice" is rejected at intake, update it to the new behaviour (legal: accepted and priced as connector; electrical: rejected by the policy with rule L3) and say so in the commit.

- [ ] **Step 2: Price and tag in requestHuman**

Replace the fee line and the insert in `requestHuman` (keep every check above it):

```ts
  let q: compliance.JobQuote;
  try {
    q = compliance.quoteJob({ budgetUsd: input.budget_usd, title: input.title, instructions: input.instructions, certification_required: input.certification_required ?? null });
  } catch (e) {
    return reject((e as Error).message);
  }
  if (q.tags.forced === "refuse") return reject(compliance.refusalReason(q.tags.rules.find((r) => r >= "L3" && r <= "L6") ?? q.tags.rules[0]));
  const feeUsd = q.feeCents / 100;
  const workerPayUsd = q.workerPayCents / 100;
  const chargeUsd = q.chargeCents / 100;
  const [job] = await ctx.sql`
    insert into jobs (customer_id, title, instructions, address, lat, lng, deadline, budget_usd, fee_usd, worker_pay_usd,
                      certification_required, proof_requirement, status, callback_url)
    values (${customerId}, ${input.title}, ${input.instructions}, ${loc.address}, ${loc.lat}, ${loc.lng},
            ${input.deadline}, ${input.budget_usd}, ${feeUsd}, ${workerPayUsd}, ${input.certification_required},
            ${ctx.sql.json({ ...input.proof, geofence_m: remote ? null : input.proof?.geofence_m ?? 150 })}, 'requested', ${input.callback_url ?? null})
    returning id`;
  await compliance.recordIntake(job.id, q);
```

with `import * as compliance from "@services/compliance/index";` at the top (match how `edwin.ts` imports other services; if it uses relative paths, use the same). Then use `chargeUsd` for `quote_usd` in both returns and for the mock ledger hold, and add one sentence to both `next_step` texts: `"Our Compliance agent decides after funding whether Operis is the provider or only the marketplace for this job; get_job shows liability_model."`

- [ ] **Step 3: Add the fields to getJob**

After the existing `Object.assign(out, {...})` in `getJob`:

```ts
  let liability: { model: string | null; reason: string | null; pricing: string } = { model: null, reason: null, pricing: "standard" };
  try {
    const [l] = await ctx.sql`select model, reason, pricing from job_liability where job_id = ${j.id}`;
    if (l) liability = { model: l.model, reason: l.reason, pricing: l.pricing };
  } catch {
    // job_liability is created by migration 0003; before it runs, report the defaults.
  }
  Object.assign(out, {
    liability_model: liability.model,
    liability_reason: liability.reason,
    pricing: liability.pricing,
    charge_usd: Number(j.worker_pay_usd) + Number(j.fee_usd),
  });
```

- [ ] **Step 4: Typecheck**

Run: `npm --prefix apps/api run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tools/edwin.ts apps/api/src/lib/safety.ts
git commit -m "api: intake prices and tags jobs by liability policy; licensed work moves from the keyword filter to the policy"
```

---

### Task 9: The Compliance agent in the job flow

**Files:**
- Modify: `contracts/states.ts` (`WAKE_ON_ENTER`)
- Modify: `apps/api/src/lib/naive.ts`
- Create: `apps/api/src/tools/liability.ts`
- Modify: `apps/api/src/app/mcp/internal/route.ts`
- Modify: `apps/api/src/lib/sweep.ts`

**Interfaces:**
- Consumes: `LIABILITY_TOOLS`, `fallbackDecision`, `hasDecision`, `releaseHold` (Task 7); `wake`, `transition`.
- Produces: `held` wakes `compliance`; after a decision the code wakes the CEO (operis, connector) or releases the hold and cancels (refuse); Ops tools refuse undecided jobs with `awaiting_liability_decision`; the sweep's fallback.

- [ ] **Step 1: Wake Compliance at funding**

In `contracts/states.ts`:

```ts
/** Which Naïve agent the API wakes when a job enters a state (via lib/naive.ts wake()). */
export const WAKE_ON_ENTER: Partial<Record<JobState, "ceo" | "ops" | "verifier" | "finance" | "compliance">> = {
  held: "compliance",
  accepted: "ops",
  proof_submitted: "verifier",
  approved: "finance",
};
```

In `apps/api/src/lib/naive.ts`: add `"compliance"` to `AgentRole`, `compliance: "NAIVE_AGENT_COMPLIANCE"` to `AGENT_ENV`, change `MESSAGES.held`, and export the CEO's message:

```ts
  held: (id) =>
    `Job ${id} is funded. Read it with get_job and get_liability_context, decide operis, connector or refuse under the liability policy, and record it with set_liability (rule id and a one-line reason).`,
```

```ts
/** After Compliance decides operis or connector, the CEO dispatches as before. */
export const liabilityDecidedMessage = (id: string, model: string) =>
  `Job ${id} is funded and cleared by Compliance (liability model: ${model}). Read it with get_job, create a board card for it with the model in the body, and assign the card to the ops member to find a worker.`;
```

- [ ] **Step 2: Glue the tools and the follow-up actions**

```ts
// apps/api/src/tools/liability.ts
// Cameron's liability model (docs/specs/2026-11-08-liability-model-design.md): the Compliance agent's tools
// and what happens after a decision. Validation and guardrails live in services/compliance.
import type { ToolContext } from "@contracts/runtime";
import * as compliance from "@services/compliance/index";
import { transition } from "@/lib/jobs";
import { liabilityDecidedMessage, wake } from "@/lib/naive";

export async function afterDecision(jobId: string, out: { model: string; next: "wake_ceo" | "cancel"; reason: string; changed: boolean }) {
  if (!out.changed) return; // a repeated call never repeats the side effects
  if (out.next === "cancel") {
    await compliance.releaseHold(jobId, `liability policy: ${out.reason}`);
    await transition(jobId, "cancelled"); // also sends the customer's callback
    return;
  }
  await wake("ceo", jobId, "liability_decided", liabilityDecidedMessage(jobId, out.model));
}

export const LIABILITY_EXTRA_TOOLS = {
  get_liability_context: (args: any, ctx: ToolContext) => compliance.LIABILITY_TOOLS.get_liability_context(args, ctx),
  set_liability: async (args: any, ctx: ToolContext) => {
    const out = await compliance.LIABILITY_TOOLS.set_liability(args, ctx);
    await afterDecision(args.job_id, out);
    return out;
  },
};

export async function requireLiabilityDecision(jobId: string) {
  if (!(await compliance.hasDecision(jobId))) {
    throw new Error("awaiting_liability_decision: the Compliance agent has not recorded this job's liability model yet. Try again after it does.");
  }
}
```

If `apps/api/src/lib/callbacks.ts`'s `notifyCustomer(jobId)` builds its payload from the jobs row, add the four liability fields there the same way as in `getJob`, and call `later(() => notifyCustomer(jobId))` after the CEO wake too, so the customer hears the decision.

- [ ] **Step 3: Mount the tools and the Ops gate**

In `apps/api/src/app/mcp/internal/route.ts`:

```ts
import { LIABILITY_EXTRA_TOOLS, requireLiabilityDecision } from "@/tools/liability";
```

```ts
    INTERNAL_TOOLS.map((name) => [name, async (args: any) => {
      if ((name === "find_people" || name === "send_blast") && args?.job_id) await requireLiabilityDecision(args.job_id);
      const { impl, source } = resolveTool(name);
      ctx.log(`${name} [${source}]`, JSON.stringify(args).slice(0, 200));
      return impl(args, ctx);
    }]),
```

```ts
  for (const [name, impl] of Object.entries(LIABILITY_EXTRA_TOOLS)) tools[name] = (args: any) => impl(args, ctx);
```

- [ ] **Step 4: The fifteen-minute fallback in the sweep**

In `apps/api/src/lib/sweep.ts`, add `liability: 0` to `report` and a new step after the overdue step:

```ts
  // 2. Funded jobs with no liability decision fifteen minutes after Compliance was woken: decide by the intake tags.
  const undecided = await sql`
    select j.id from jobs j
    join wake_events w on w.job_id = j.id and w.event = 'held'
    left join job_liability l on l.job_id = j.id
    where j.status = 'held' and (l.job_id is null or l.model is null)
      and w.created_at < now() - interval '15 minutes'`.catch(() => [] as any[]); // before migration 0003
  for (const j of undecided) {
    try {
      const out = await compliance.fallbackDecision(j.id);
      await afterDecision(j.id, out);
      report.liability++;
    } catch (e) {
      report.errors.push(`${j.id}: ${String(e).slice(0, 120)}`);
    }
  }
```

Import `* as compliance from "@services/compliance/index"` and `afterDecision` from `@/tools/liability`, renumber the comments below, and add `report.liability` to the route's logging condition in `apps/api/src/app/api/cron/sweep/route.ts`.

- [ ] **Step 5: Typecheck**

Run: `npm --prefix apps/api run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add contracts/states.ts apps/api/src/lib/naive.ts apps/api/src/tools/liability.ts apps/api/src/app/mcp/internal/route.ts apps/api/src/lib/sweep.ts apps/api/src/app/api/cron/sweep/route.ts apps/api/src/lib/callbacks.ts
git commit -m "api: Compliance decides after funding; CEO wakes on the decision; Ops waits; sweep fallback after fifteen minutes"
```

---

### Task 10: Worker side: licence check route and the accept gate

**Files:**
- Create: `apps/api/src/app/v1/worker/license/route.ts`
- Modify: `apps/api/src/lib/worker.ts` (`acceptJob`)
- Modify: `apps/api/src/app/v1/worker/jobs/[token]/accept/route.ts`

**Interfaces:**
- Consumes: `verifyLicence`, `eligibilityForAccept` (Task 7); `outreachByToken` from `@/lib/worker`.
- Produces: `POST /v1/worker/license { token, kind: "notary" | "attorney", number, name }` → the check result; `acceptJob` refuses an ineligible worker with `{ ok: false, reason: "not_eligible", reasons }`; the accept route answers that with HTTP 403 and the reasons.

- [ ] **Step 1: The licence route**

```ts
// apps/api/src/app/v1/worker/license/route.ts
// POST { token, kind: "notary" | "attorney", number, name }: the worker proves the licence a connector job needs
// (policy L1 notary commission, L2 State Bar). Cameron's services/compliance; docs/specs/2026-11-08-liability-model-design.md.
import { outreachByToken } from "@/lib/worker";
import * as compliance from "@services/compliance/index";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const o = typeof body?.token === "string" ? await outreachByToken(body.token) : undefined;
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  if (!["notary", "attorney"].includes(body.kind) || typeof body.number !== "string" || typeof body.name !== "string") {
    return Response.json({ error: "bad_request", detail: "kind (notary or attorney), number and name are required" }, { status: 400 });
  }
  return Response.json(await compliance.verifyLicence({ workerId: o.worker_id, jobId: o.job_id, kind: body.kind, number: body.number, name: body.name }));
}
```

- [ ] **Step 2: The accept gate**

In `apps/api/src/lib/worker.ts`, read the current `acceptJob` first (PR #32 changed the job page flow). Before the transition to `accepted`, add:

```ts
  const elig = await eligibilityForAccept(o.worker_id, o.job_id).catch((e) => ({
    eligible: false,
    reasons: [`eligibility_check_failed: ${String(e).slice(0, 120)}`],
  }));
  if (!elig.eligible) return { ok: false, reason: "not_eligible", reasons: elig.reasons };
```

with `import { eligibilityForAccept } from "@services/compliance/index";` and the return type widened to `{ ok: true } | { ok: false; reason: string; reasons?: string[] }`.

In the accept route:

```ts
  return r.ok
    ? Response.json({ ok: true, state: "accepted" })
    : Response.json({ ok: false, error: r.reason, reasons: "reasons" in r ? r.reasons : undefined }, { status: r.reason === "not_eligible" ? 403 : 409 });
```

The eligibility check fails closed on errors except a missing `job_liability` table, which the repository treats as "no tags" (Task 3), so the gate is safe to deploy before migration 0003.

- [ ] **Step 3: Typecheck**

Run: `npm --prefix apps/api run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add "apps/api/src/app/v1/worker/license/route.ts" apps/api/src/lib/worker.ts "apps/api/src/app/v1/worker/jobs/[token]/accept/route.ts"
git commit -m "api: licence check route and the eligibility gate at accept (403 with reasons)"
```

---

### Task 11: The agent, prompts, guide and migration list

**Files:**
- Create: `agents/prompts/compliance.md`
- Modify: `agents/agents.json`, `agents/prompts/ceo.md`, `agents/prompts/disputes.md`, `apps/api/src/lib/guide.ts`, `scripts/migrate.ts`

- [ ] **Step 1: The Compliance prompt**

```markdown
You are Compliance at Operis, an autonomous company that sends humans to do jobs for other companies' agents.
For every funded job you decide who holds the liability for the work.

When told a job is funded:
1. Read it with `operis.get_job` (title, instructions, certification, location, budget).
2. Read `operis.get_liability_context`: the intake tags, the pricing, the models you may choose, and the full policy.
3. Decide one model and the rule that justifies it:
   - `operis` (rule D): Operis is the provider and holds the liability. The default for any job no rule covers.
   - `connector` (rule L1, L2 or U): the worker provides the service under their own licence and holds the
     liability; Operis is only the marketplace and the payment agent. Only where Operis legally cannot hold it.
   - `refuse` (rule L3 to L6, R, or L1/L2 when the context says the job was priced as standard): nobody can take
     it under the policy. The hold is released and the customer gets your reason.
4. Call `operis.set_liability` with `job_id`, `model`, `rule_id` and a one-line `reason` the customer can read.
   The system then wakes the CEO or cancels the job; you do nothing else for this job.

Rules you cannot break:
- Never choose a model outside `allowed_models`. Intake tags are decided by code and you cannot overrule them.
- When you cannot tell whether a rule applies, choose `connector` with rule U and say what was unclear.
- If `set_liability` answers `repost_required`, refuse with the same L rule and tell the customer to post the
  job again as a notary or legal job.
- If it answers `already_decided`, stop: the decision stands.
- You never ask a human. The policy is the founders' instruction; apply it as written.
```

- [ ] **Step 2: Register the agent**

In `agents/agents.json`, add to `members` (follow the shape of the `ops` member):

```json
"compliance": {
  "name": "operis-compliance",
  "description": "Decides for each funded job whether Operis holds the liability, only connects, or refuses, under the liability policy.",
  "budget_usd": { "cap": 20, "max_task": 2 },
  "tools": {
    "operis.get_job": "allow",
    "operis.get_liability_context": "allow",
    "operis.set_liability": "allow",
    "board_read": "allow",
    "board_write": "allow"
  },
  "$comment": "Cameron, docs/specs/2026-11-08-liability-model-design.md. Woken on held (contracts/states.ts WAKE_ON_ENTER). Create with npm run agents:setup after the PR merges, then set NAIVE_AGENT_COMPLIANCE on Vercel."
}
```

If members carry a `system` prompt path or a model field, mirror what `ops` does and point it at `agents/prompts/compliance.md`.

- [ ] **Step 3: CEO, Disputes, guide, migrations**

- `agents/prompts/ceo.md`: replace "When you're told a job is funded:" with "When Compliance has cleared a funded job (the message names its liability model):", and add to step 2 "and its liability model".
- `agents/prompts/disputes.md`: add a paragraph: "On a connector job (get_job's `liability_model` is `connector`) the worker provided the service under their own licence and holds the liability for it. Refund only for work not delivered: no approved proof, expired, or cancelled. A complaint about the quality of licensed work goes to the worker as the responsible provider; send the customer the worker's name and licence number and our records, and do not refund it."
- `apps/api/src/lib/guide.ts`, in the request_human section: "Liability: after your job is funded, our Compliance agent decides whether Operis is the provider (`operis`, the default) or only the marketplace (`connector`, for work only a licensed person may do, such as notarizing or legal review). `get_job` shows `liability_model` and the reason. On connector jobs the licensed worker is responsible for the professional work, the worker receives your whole budget, and our platform fee is added on top (`charge_usd`). Work that needs a licence we cannot verify yet is refused before you pay."
- `scripts/migrate.ts`: append `"services/money-verification/migrations/0003_job_liability.sql"` to `MIGRATIONS`, after `0002_customer_payment.sql` if PR #23 has added it.

- [ ] **Step 4: Check and commit**

Run: `python3 -c "import json; json.load(open('agents/agents.json'))" && npm --prefix apps/api run typecheck`
Expected: no output from Python; typecheck exit 0.

```bash
git add agents/prompts/compliance.md agents/agents.json agents/prompts/ceo.md agents/prompts/disputes.md apps/api/src/lib/guide.ts scripts/migrate.ts
git commit -m "agents: Compliance agent (prompt, member, CEO and Disputes handoff); guide paragraph; migration 0003 listed"
```

---

### Task 12: End-to-end checks and the PR

- [ ] **Step 1: Rebase and run every check**

```bash
git fetch origin && git rebase origin/claude/zealous-newton-ld8eog
cd services/money-verification && ../../node_modules/.bin/tsc --noEmit && ../../node_modules/.bin/vitest run && cd ../..
node_modules/.bin/tsc -p <your shim tsconfig covering payments, verify and compliance>
npm --prefix apps/api run typecheck
```

Expected: all exit 0; paste the real output into the PR.

- [ ] **Step 2: Live hold in test mode**

From a scratch script (never committed), with the key read in-process from the Stripe CLI `operis` profile: build a connector job of $200 with `quoteJob`, seed it in an `InMemoryRepo` with `worker_pay_cents` and `fee_cents` from the quote, run `createEscrow`, and assert the Checkout session's amount is 23000 cents; then release it with the package's release path. Paste the session id and amount, labelled VERIFIED.

- [ ] **Step 3: Prompt smoke check with the local model**

Feed `agents/prompts/compliance.md`, `policyText()` and five fixture jobs (photo job, notary, contract review, rewire, a vague "help with paperwork") to `~/.local/bin/local-llm` one at a time and record the model and rule it picks. Not authoritative; report mismatches in the PR.

- [ ] **Step 4: Open the PR**

Title: `Per-job liability model: Compliance agent, policy v1, connector pricing`. Base `claude/zealous-newton-ld8eog`. Body sections: What changes; Deviations from the spec (rule R; L3 to L6 rejected at intake before payment); Verification (real output); Rollout for Cameron (1. merge, 2. `npm run db:migrate` for 0003, 3. `npm run agents:setup` to create operis-compliance, 4. set `NAIVE_AGENT_COMPLIANCE` on Vercel to the new agent id and redeploy, 5. one notary and one legal job in the sandbox); Ask Edwin to stay out of the shared files listed in Global Constraints until this merges; Paste-ready for Dora (job page: show `liability_model` with one line per model; the accept line "By accepting you agree to the Worker Terms for this job type" naming the model; on HTTP 403 from accept show `reasons` from the response instead of the identity message; on L1/L2 jobs a small form posting `{ token, kind, number, name }` to `/v1/worker/license` before the accept button); Questions for counsel (from the spec); what the local model drafted.

- [ ] **Step 5: Report to the coordinator**

Send the PR link and a summary with every claim labelled VERIFIED, INFERRED or NOT RUN.
