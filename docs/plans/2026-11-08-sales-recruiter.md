# Sales and Recruiter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, inline in this session (the brief rules out subagent-driven development and Workflow fan-outs). Steps use checkbox (`- [ ]`) syntax for tracking. Full-file code blocks carry a `<!-- file: path -->` marker so they can be written to disk exactly as reviewed; the committed files are authoritative if a test forces a change.

**Goal:** Sales markets Operis to hand-sourced agent builders and the new Recruiter grows the pre-vetted (opted in + ID verified) worker pool, both sending only through guarded `services/growth` tools.

**Architecture:** A new package `services/growth` holds one guard (every sending rule), the fixed email copy, signed links, demand targeting, the free-first-job grants and a repository over three new tables. It reuses Andrew's people search, pool and senders as a library and Cameron's `createIdentityLink`, unchanged. Seven contract tools reach the agents through apps/api's internal MCP server; two new routes serve the unsubscribe and join links.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), vitest, Postgres (postgres.js in apps/api, PGlite for the SQL check), Next.js route handlers.

**Spec:** `docs/specs/2026-11-08-sales-recruiter-design.md` (approved by Cameron in session sales-growth-ff6d5d). Read it first.

## Global Constraints

- Email only. No SMS, DMs or public posts. No real email outside `OUTREACH_TEST_ALLOWLIST` unless `GROWTH_LIVE` names the kind **and** `GROWTH_POSTAL_ADDRESS` is set; this PR sets neither anywhere.
- Every message: names Operis, says it is marketing or an invitation, has "How we found you: …", the postal address and a one-click unsubscribe link that never expires.
- Caps (Pacific day, sends + dry runs): 25 marketing, 40 invites. Monid search: $2/day, $0.50 per call. Free first job: $25 cap, 20 grants, one per company domain, 14 days.
- Public, work-related contacts only: prospects come from a hand-made CSV; recruits from `findPeopleDetailed` with ContactOut (`linkedinWorkEmail`) removed and businesses dropped.
- Do not edit: `services/outreach/**`, `services/money-verification/**`, `services/payments/**`, `services/verify/**`, `apps/web/**`, and PR #42's files (`agents/agents.json`, `agents/prompts/ceo.md`, `apps/api/src/app/mcp/internal/route.ts`, `apps/api/src/mcp/schemas.ts`, `apps/api/src/lib/{approvals,agentFeed,guide}.ts`, `scripts/{migrate,approvals}.ts`, `docs/GO_LIVE.md`, `apps/api/.env.example`). Their changes go in the PR body as snippets.
- Never run the migration, `npm run agents:setup`, a deploy or a merge. Never print secrets.
- Checks use the root binaries: in `services/growth` run `../../node_modules/.bin/vitest run` and `../../node_modules/.bin/tsc --noEmit`; for the API run `npm --prefix apps/api run typecheck`.
- One logical change per commit; commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `services/growth/src/env.ts` | `GrowthEnv`, defaults, `growthEnvFromProcess` |
| `src/time.ts` | Pacific day start, dates for copy |
| `src/links.ts` | signed unsubscribe and join tokens and URLs |
| `src/families.ts` | the four job families: copy, search hints, floor targets |
| `src/types.ts` | contact, log, grant and read-model shapes |
| `src/templates.ts` | the marketing email and the invite; personal-line rules |
| `src/repo.ts`, `src/repo/memory.ts`, `src/repo/postgres.ts` | `GrowthRepo` and its two implementations |
| `src/deps.ts` | `GrowthDeps` (env, repo, Andrew's pool, senders, Monid, identity, clock) |
| `src/optout.ts` | opted-out check and opt-out everywhere |
| `src/guard.ts` | `decide`: the only place the sending rules live |
| `src/deliver.ts` | carry out a send or dry run and log it |
| `src/promo.ts`, `src/redeem.ts` | free-first-job grants; their redemption by the CEO |
| `src/sales.ts` | `list_prospects`, `send_marketing`, `suppress_contact` |
| `src/recruit.ts` | `recruit_search`, `recruit_invite` |
| `src/pages.ts` | unsubscribe and join pages |
| `src/demand.ts`, `src/report.ts` | demand by family and targets; `growth_report` |
| `src/prospects.ts` | CSV parsing for the hand-sourced list |
| `src/tools.ts`, `src/index.ts` | tool surface; public exports |
| `services/growth/index.ts` | binds tools and pages to apps/api (database, env, senders, Stripe Identity) |
| `services/growth/migrations/0001_growth.sql` | the three tables |
| `services/growth/scripts/{import-prospects,dry-run}.ts` | CSV import; the committed dry-run transcript |
| `apps/api/src/mcp/growthSchemas.ts` (new), `apps/api/src/mcp/server.ts` | tool input schemas; merged lookup |
| `contracts/tools.ts`, `apps/api/src/tools/{registry,mocks}.ts` | contract entries, registration, mocks |
| `apps/api/src/app/v1/growth/{unsubscribe,join}/route.ts` | the two link routes |
| `agents/prompts/sales.md`, `agents/prompts/recruiter.md` | the agents' instructions |

---

### Task 1: Package skeleton, configuration, time and signed links

**Files:**
- Create: `services/growth/package.json`, `services/growth/tsconfig.json`, `services/growth/vitest.config.ts`, `services/growth/src/env.ts`, `services/growth/src/time.ts`, `services/growth/src/links.ts`
- Test: `services/growth/test/env.test.ts`, `services/growth/test/time.test.ts`, `services/growth/test/links.test.ts`

**Interfaces:**
- Produces: `GrowthEnv`, `LiveKind`, `GROWTH_DEFAULTS`, `growthEnvFromProcess(src?)`; `DAY_MS`, `pacificDayStart(now)`, `pacificDate(now)`, `shortDate(d)`; `LinkPurpose`, `JOIN_TTL_DAYS`, `signLink(secret, purpose, contactId, now?)`, `verifyLink(secret, token, purpose, now?) → string | null`, `unsubscribeUrl(base, token)`, `joinUrl(base, token)`.

- [ ] **Step 1: Package files**

<!-- file: services/growth/package.json -->
```json
{
  "name": "@operis/growth",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Operis growth: the Sales agent's marketing email and the Recruiter's worker invites, with every sending rule enforced in code. Owner: Cameron.",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "dry-run": "tsx scripts/dry-run.ts",
    "import-prospects": "tsx scripts/import-prospects.ts"
  }
}
```

<!-- file: services/growth/tsconfig.json -->
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts"]
}
```

<!-- file: services/growth/vitest.config.ts -->
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 2: Write the failing tests**

<!-- file: services/growth/test/env.test.ts -->
```ts
import { describe, expect, it } from 'vitest';
import { growthEnvFromProcess } from '../src/env.js';

const base = { PUBLIC_BASE_URL: 'https://operis.live/', LINK_SIGNING_SECRET: 's' };

describe('growthEnvFromProcess', () => {
  it('reads the defaults, the allowlist and the invite sender fallback', () => {
    const e = growthEnvFromProcess({ ...base, OUTREACH_TEST_ALLOWLIST: ' Team@Operis.example ,x@y.example', AGENTMAIL_INBOX: 'ops@mail.operis.live' });
    expect(e.PUBLIC_BASE_URL).toBe('https://operis.live');
    expect(e.GROWTH_LIVE).toEqual([]);
    expect(e.GROWTH_PAUSE).toBe(false);
    expect(e.GROWTH_POSTAL_ADDRESS).toBeNull();
    expect(e.OUTREACH_TEST_ALLOWLIST).toEqual(['team@operis.example', 'x@y.example']);
    expect([e.GROWTH_SALES_DAILY_CAP, e.GROWTH_RECRUIT_DAILY_CAP, e.GROWTH_SEARCH_DAILY_USD]).toEqual([25, 40, 2]);
    expect([e.GROWTH_PROMO_MAX_GRANTS, e.GROWTH_PROMO_CAP_USD, e.GROWTH_PROMO_DAYS]).toEqual([20, 25, 14]);
    expect(e.GROWTH_RECRUIT_AGENTMAIL_INBOX).toBe('ops@mail.operis.live');
  });

  it('PAUSE_OUTREACH pauses growth too; GROWTH_LIVE takes only sales and recruit', () => {
    expect(growthEnvFromProcess({ ...base, PAUSE_OUTREACH: 'true' }).GROWTH_PAUSE).toBe(true);
    expect(growthEnvFromProcess({ ...base, GROWTH_LIVE: 'sales, Recruit' }).GROWTH_LIVE).toEqual(['sales', 'recruit']);
    expect(() => growthEnvFromProcess({ ...base, GROWTH_LIVE: 'everyone' })).toThrow(/unknown kind/);
  });

  it('requires the link base and secret, and rejects bad numbers', () => {
    expect(() => growthEnvFromProcess({ LINK_SIGNING_SECRET: 's' })).toThrow(/PUBLIC_BASE_URL/);
    expect(() => growthEnvFromProcess({ PUBLIC_BASE_URL: 'https://operis.live' })).toThrow(/LINK_SIGNING_SECRET/);
    expect(() => growthEnvFromProcess({ ...base, GROWTH_SALES_DAILY_CAP: '-1' })).toThrow(/GROWTH_SALES_DAILY_CAP/);
  });
});
```

<!-- file: services/growth/test/time.test.ts -->
```ts
import { describe, expect, it } from 'vitest';
import { pacificDate, pacificDayStart, shortDate } from '../src/time.js';

describe('Pacific time helpers', () => {
  it('starts the day at midnight Pacific', () => {
    expect(pacificDayStart(new Date('2026-11-08T05:30:00Z')).toISOString()).toBe('2026-11-07T08:00:00.000Z');
    expect(pacificDayStart(new Date('2026-11-08T18:00:00Z')).toISOString()).toBe('2026-11-08T08:00:00.000Z');
  });

  it('formats dates for reports and email copy', () => {
    expect(pacificDate(new Date('2026-11-08T05:30:00Z'))).toBe('2026-11-07');
    expect(shortDate(new Date('2026-11-22T18:00:00Z'))).toBe('Sun Nov 22');
  });
});
```

<!-- file: services/growth/test/links.test.ts -->
```ts
import { describe, expect, it } from 'vitest';
import { joinUrl, signLink, unsubscribeUrl, verifyLink } from '../src/links.js';

const ID = '0b6f3c1e-8d2a-4c7b-9a1e-2f3d4c5b6a79';

describe('signed links', () => {
  it('unsubscribe tokens never expire', () => {
    const t = signLink('s', 'unsubscribe', ID, new Date('2026-01-01T00:00:00Z'));
    expect(verifyLink('s', t, 'unsubscribe', new Date('2036-01-01T00:00:00Z'))).toBe(ID);
  });

  it('join tokens last 30 days', () => {
    const t = signLink('s', 'join', ID, new Date('2026-11-08T00:00:00Z'));
    expect(verifyLink('s', t, 'join', new Date('2026-12-07T00:00:00Z'))).toBe(ID);
    expect(verifyLink('s', t, 'join', new Date('2026-12-09T00:00:00Z'))).toBeNull();
  });

  it('rejects the other purpose, a tampered id, the wrong secret and junk', () => {
    const u = signLink('s', 'unsubscribe', ID);
    expect(verifyLink('s', u, 'join')).toBeNull();
    expect(verifyLink('s', u.replace(ID, ID.replace('0b6f', '1b6f')), 'unsubscribe')).toBeNull();
    expect(verifyLink('other', u, 'unsubscribe')).toBeNull();
    expect(verifyLink('s', 'garbage', 'unsubscribe')).toBeNull();
    expect(verifyLink('s', null, 'unsubscribe')).toBeNull();
  });

  it('builds URLs with no email in them', () => {
    const url = unsubscribeUrl('https://operis.live', signLink('s', 'unsubscribe', ID));
    expect(url).toMatch(/^https:\/\/operis\.live\/v1\/growth\/unsubscribe\?t=u\./);
    expect(url).not.toContain('@');
    expect(joinUrl('https://operis.live', 'x')).toBe('https://operis.live/v1/growth/join?t=x');
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd services/growth && ../../node_modules/.bin/vitest run`
Expected: FAIL, cannot find `../src/env.js`, `../src/time.js`, `../src/links.js`.

- [ ] **Step 4: Implement**

<!-- file: services/growth/src/env.ts -->
```ts
/**
 * Configuration for services/growth (the Sales agent's marketing email, the Recruiter's invites). Only
 * growthEnvFromProcess() reads process.env, so tests build a GrowthEnv by hand. Secret values are never logged.
 */
export type LiveKind = 'sales' | 'recruit';

export interface GrowthEnv {
  /** Base of every link in our emails, e.g. https://operis.live (operis.live rewrites /v1/* to the API). */
  PUBLIC_BASE_URL: string;
  /** HMAC key for unsubscribe and join links; domain-separated from job links by a "growth:" prefix. */
  LINK_SIGNING_SECRET: string;
  /** Kinds that may email anyone (live also needs GROWTH_POSTAL_ADDRESS). Empty: allowlist and dry runs only. */
  GROWTH_LIVE: LiveKind[];
  /** GROWTH_PAUSE=true or PAUSE_OUTREACH=true: nothing is sent at all. */
  GROWTH_PAUSE: boolean;
  /** Team addresses that may receive real email while not live (shared with services/outreach). Lowercased. */
  OUTREACH_TEST_ALLOWLIST: string[];
  /** CAN-SPAM postal address printed in every email. Live sends are refused without it. */
  GROWTH_POSTAL_ADDRESS: string | null;
  /** Marketing emails (sent + dry runs) per Pacific day. */
  GROWTH_SALES_DAILY_CAP: number;
  /** Invites (sent + dry runs) per Pacific day. */
  GROWTH_RECRUIT_DAILY_CAP: number;
  /** Monid spend per Pacific day for recruit_search, USD. */
  GROWTH_SEARCH_DAILY_USD: number;
  GROWTH_PROMO_MAX_GRANTS: number;
  GROWTH_PROMO_CAP_USD: number;
  GROWTH_PROMO_DAYS: number;
  MONID_API_KEY: string | null;
  MONID_BASE_URL: string;
  NAIVE_API_KEY: string | null;
  NAIVE_BASE_URL: string;
  /** Naïve Sales identity inbox: marketing goes out from it, so replies wake Sales. */
  GROWTH_SALES_NAIVE_IDENTITY_ID: string | null;
  GROWTH_SALES_NAIVE_INBOX_ID: string | null;
  /** Fallback marketing sender: an AgentMail inbox through Monid. */
  GROWTH_SALES_AGENTMAIL_INBOX: string | null;
  /** Invite sender: an AgentMail inbox through Monid. Defaults to AGENTMAIL_INBOX (Andrew's ops@mail.operis.live). */
  GROWTH_RECRUIT_AGENTMAIL_INBOX: string | null;
}

export const GROWTH_DEFAULTS = {
  GROWTH_SALES_DAILY_CAP: 25,
  GROWTH_RECRUIT_DAILY_CAP: 40,
  GROWTH_SEARCH_DAILY_USD: 2,
  GROWTH_PROMO_MAX_GRANTS: 20,
  GROWTH_PROMO_CAP_USD: 25,
  GROWTH_PROMO_DAYS: 14,
  MONID_BASE_URL: 'https://api.monid.ai',
  NAIVE_BASE_URL: 'https://api.vetta.sh',
} as const;

const text = (v: string | undefined): string | null => (v !== undefined && v.trim() !== '' ? v.trim() : null);
const flag = (v: string | undefined): boolean => v === 'true' || v === '1';
const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

function num(name: string, v: string | undefined, fallback: number): number {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

function required(name: string, v: string | undefined): string {
  const s = text(v);
  if (!s) throw new Error(`${name} is required`);
  return s;
}

export function growthEnvFromProcess(src: NodeJS.ProcessEnv = process.env): GrowthEnv {
  const live = list(src.GROWTH_LIVE);
  for (const k of live) if (k !== 'sales' && k !== 'recruit') throw new Error(`GROWTH_LIVE: unknown kind "${k}" (use sales, recruit)`);
  const d = GROWTH_DEFAULTS;
  return {
    PUBLIC_BASE_URL: required('PUBLIC_BASE_URL', src.PUBLIC_BASE_URL).replace(/\/+$/, ''),
    LINK_SIGNING_SECRET: required('LINK_SIGNING_SECRET', src.LINK_SIGNING_SECRET),
    GROWTH_LIVE: live as LiveKind[],
    GROWTH_PAUSE: flag(src.GROWTH_PAUSE) || flag(src.PAUSE_OUTREACH),
    OUTREACH_TEST_ALLOWLIST: list(src.OUTREACH_TEST_ALLOWLIST),
    GROWTH_POSTAL_ADDRESS: text(src.GROWTH_POSTAL_ADDRESS),
    GROWTH_SALES_DAILY_CAP: num('GROWTH_SALES_DAILY_CAP', src.GROWTH_SALES_DAILY_CAP, d.GROWTH_SALES_DAILY_CAP),
    GROWTH_RECRUIT_DAILY_CAP: num('GROWTH_RECRUIT_DAILY_CAP', src.GROWTH_RECRUIT_DAILY_CAP, d.GROWTH_RECRUIT_DAILY_CAP),
    GROWTH_SEARCH_DAILY_USD: num('GROWTH_SEARCH_DAILY_USD', src.GROWTH_SEARCH_DAILY_USD, d.GROWTH_SEARCH_DAILY_USD),
    GROWTH_PROMO_MAX_GRANTS: num('GROWTH_PROMO_MAX_GRANTS', src.GROWTH_PROMO_MAX_GRANTS, d.GROWTH_PROMO_MAX_GRANTS),
    GROWTH_PROMO_CAP_USD: num('GROWTH_PROMO_CAP_USD', src.GROWTH_PROMO_CAP_USD, d.GROWTH_PROMO_CAP_USD),
    GROWTH_PROMO_DAYS: num('GROWTH_PROMO_DAYS', src.GROWTH_PROMO_DAYS, d.GROWTH_PROMO_DAYS),
    MONID_API_KEY: text(src.MONID_API_KEY),
    MONID_BASE_URL: (text(src.MONID_BASE_URL) ?? d.MONID_BASE_URL).replace(/\/+$/, ''),
    NAIVE_API_KEY: text(src.NAIVE_API_KEY),
    NAIVE_BASE_URL: (text(src.NAIVE_BASE_URL) ?? d.NAIVE_BASE_URL).replace(/\/+$/, ''),
    GROWTH_SALES_NAIVE_IDENTITY_ID: text(src.GROWTH_SALES_NAIVE_IDENTITY_ID),
    GROWTH_SALES_NAIVE_INBOX_ID: text(src.GROWTH_SALES_NAIVE_INBOX_ID),
    GROWTH_SALES_AGENTMAIL_INBOX: text(src.GROWTH_SALES_AGENTMAIL_INBOX),
    GROWTH_RECRUIT_AGENTMAIL_INBOX: text(src.GROWTH_RECRUIT_AGENTMAIL_INBOX) ?? text(src.AGENTMAIL_INBOX),
  };
}
```

<!-- file: services/growth/src/time.ts -->
```ts
/** Time helpers. "Today" for caps and budgets is the Pacific day: Operis runs in San Francisco. */
export const DAY_MS = 86_400_000;

const PT = 'America/Los_Angeles';

/** Midnight Pacific time of the day containing `now` (up to an hour off on the two DST change days). */
export function pacificDayStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PT,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const msIntoDay = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + now.getUTCMilliseconds();
  return new Date(now.getTime() - msIntoDay);
}

/** YYYY-MM-DD in Pacific time. */
export function pacificDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** "Sun Nov 22" in Pacific time, for email copy. */
export function shortDate(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: PT, weekday: 'short', month: 'short', day: 'numeric' }).format(d).replace(',', '');
}
```

<!-- file: services/growth/src/links.ts -->
```ts
/**
 * Signed links in growth emails: the one-click unsubscribe link (never expires) and the Recruiter's join link
 * (30 days). Token = `<u|j>.<contact id>.<expiry, unix seconds; 0 = never>.<mac>`: opaque, with no email or name
 * in the URL. The MAC is HMAC-SHA256 over "growth:" plus the first three parts, so a job-link signature made with
 * the same secret can never pass here.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type LinkPurpose = 'unsubscribe' | 'join';
export const JOIN_TTL_DAYS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tag = (p: LinkPurpose) => (p === 'unsubscribe' ? 'u' : 'j');
const mac = (secret: string, body: string) => createHmac('sha256', secret).update(`growth:${body}`).digest('base64url').slice(0, 22);

export function signLink(secret: string, purpose: LinkPurpose, contactId: string, now: Date = new Date()): string {
  const exp = purpose === 'join' ? Math.floor(now.getTime() / 1000) + JOIN_TTL_DAYS * 86_400 : 0;
  const body = `${tag(purpose)}.${contactId}.${exp}`;
  return `${body}.${mac(secret, body)}`;
}

/** The contact id inside a valid, unexpired token for `purpose`; null otherwise. */
export function verifyLink(secret: string, token: string | null | undefined, purpose: LinkPurpose, now: Date = new Date()): string | null {
  const parts = (token ?? '').split('.');
  if (parts.length !== 4) return null;
  const [t, id, expRaw, sig] = parts as [string, string, string, string];
  if (t !== tag(purpose) || !UUID.test(id) || !/^\d+$/.test(expRaw)) return null;
  const want = Buffer.from(mac(secret, `${t}.${id}.${expRaw}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const exp = Number(expRaw);
  if (exp !== 0 && exp * 1000 < now.getTime()) return null;
  return id.toLowerCase();
}

export const unsubscribeUrl = (base: string, token: string): string => `${base}/v1/growth/unsubscribe?t=${token}`;
export const joinUrl = (base: string, token: string): string => `${base}/v1/growth/join?t=${token}`;
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `cd services/growth && ../../node_modules/.bin/vitest run && ../../node_modules/.bin/tsc --noEmit`
Expected: 3 files, all tests pass; tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add services/growth/package.json services/growth/tsconfig.json services/growth/vitest.config.ts services/growth/src/env.ts services/growth/src/time.ts services/growth/src/links.ts services/growth/test/env.test.ts services/growth/test/time.test.ts services/growth/test/links.test.ts
git commit -m "growth: package skeleton, configuration, Pacific day and signed unsubscribe/join links"
```

---

### Task 2: Families, shared types and the two emails

**Files:**
- Create: `services/growth/src/families.ts`, `services/growth/src/types.ts`, `services/growth/src/templates.ts`
- Test: `services/growth/test/templates.test.ts`

**Interfaces:**
- Consumes: `shortDate` (Task 1); `greetingName` from `services/outreach/src/templates.ts`; `SearchHints` from `services/outreach/src/types.ts`.
- Produces: `Family`, `FamilySpec`, `FAMILIES`, `FAMILY_KEYS`, `isFamily`, `PIER70`, `RADIUS_KM`; `Contact`, `NewContact`, `ContactKind`, `MessageKind`, `LogKind`, `LogStatus`, `LogEntry`, `Grant`, `JobRow`, `JobWithCustomer`, `VerificationRow`; `EmailMessage`, `PERSONAL_LINE_MAX`, `PENDING_ADDRESS`, `firstNameOf`, `cleanPersonalLine → CleanLine`, `renderMarketing(MarketingCopy)`, `renderInvite(InviteCopy)`.

- [ ] **Step 1: Write the failing test**

<!-- file: services/growth/test/templates.test.ts -->
```ts
import { describe, expect, it } from 'vitest';
import { FAMILIES } from '../src/families.js';
import { cleanPersonalLine, PENDING_ADDRESS, renderInvite, renderMarketing } from '../src/templates.js';

const UNSUB = 'https://operis.live/v1/growth/unsubscribe?t=u.0b6f3c1e-8d2a-4c7b-9a1e-2f3d4c5b6a79.0.abc';
const ADDRESS = '1 Example St, San Francisco, CA 94100';
const marketing = { firstName: 'Jane', personalLine: null, promo: null, foundVia: 'the YC x Naïve hackathon team list', postalAddress: ADDRESS, unsubscribeUrl: UNSUB };

describe('renderMarketing', () => {
  it('carries every required part', () => {
    const m = renderMarketing(marketing);
    expect(m.subject).not.toMatch(/^(re|fwd?):/i);
    for (const part of [
      'Hi Jane,',
      'request_human',
      'https://operis.live/SKILL.md',
      'https://operis.live/mcp',
      'https://operis.live/developers',
      'How we found you: the YC x Naïve hackathon team list.',
      'This is a marketing email from Operis.',
      'Operis Sales (an AI agent) · operis.live',
      ADDRESS,
      UNSUB,
    ]) expect(m.text).toContain(part);
    expect(m.text).not.toContain('first job is on us');
  });

  it('adds the personal line and the promo only when given', () => {
    const m = renderMarketing({ ...marketing, personalLine: 'Your agent books venues.', promo: { capUsd: 25, expiresAt: new Date('2026-11-22T18:00:00Z') } });
    expect(m.text).toContain('Hi Jane,\n\nYour agent books venues.\n');
    expect(m.text).toContain("Your team's first job is on us: we refund it in full, up to $25, once the proof passes. One per team; the offer ends Sun Nov 22.");
  });

  it('greets without a name and marks a test email without a postal address', () => {
    const m = renderMarketing({ ...marketing, firstName: null, postalAddress: null });
    expect(m.text.startsWith('Hi there,')).toBe(true);
    expect(m.text).toContain(PENDING_ADDRESS);
  });
});

describe('renderInvite', () => {
  const f = FAMILIES.sf_notaries;
  const invite = { firstName: 'Ada', familyLabel: f.label, familySubject: f.subject, joinUrl: 'https://operis.live/v1/growth/join?t=j.x', foundVia: 'your public LinkedIn profile, where you list "Mobile notary"', postalAddress: ADDRESS, unsubscribeUrl: UNSUB };

  it('carries the family, join link, ID step, found line, label, address and unsubscribe link', () => {
    const m = renderInvite(invite);
    expect(m.subject).toBe('Join Operis: paid notary signings in San Francisco');
    for (const part of [
      'Hi Ada,',
      'The work: mobile notary signings in San Francisco.',
      'https://operis.live/v1/growth/join?t=j.x',
      'verify your ID once with Stripe',
      'How we found you: your public LinkedIn profile, where you list "Mobile notary".',
      'This is an invitation from Operis.',
      ADDRESS,
      UNSUB,
    ]) expect(m.text).toContain(part);
  });

  it('never states a pay amount', () => {
    expect(renderInvite(invite).text).not.toMatch(/\$\s?\d/);
  });
});

describe('cleanPersonalLine', () => {
  it('keeps one tidy line, at most 300 characters, with no links', () => {
    expect(cleanPersonalLine('  Loved   your\nagent ')).toEqual({ ok: true, line: 'Loved your agent' });
    expect(cleanPersonalLine(undefined)).toEqual({ ok: true, line: null });
    expect(cleanPersonalLine('see https://x.example')).toEqual({ ok: false, reason: 'personal_line_has_link' });
    expect(cleanPersonalLine('see www.agentco.dev')).toEqual({ ok: false, reason: 'personal_line_has_link' });
    expect(cleanPersonalLine('see agentco.dev')).toEqual({ ok: false, reason: 'personal_line_has_link' });
    expect(cleanPersonalLine('a'.repeat(301))).toEqual({ ok: false, reason: 'personal_line_too_long' });
    expect(cleanPersonalLine('Built with Next.js and React')).toEqual({ ok: true, line: 'Built with Next.js and React' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd services/growth && ../../node_modules/.bin/vitest run test/templates.test.ts`
Expected: FAIL, cannot find `../src/families.js`.

- [ ] **Step 3: Implement**

<!-- file: services/growth/src/families.ts -->
```ts
/** The job families the Recruiter grows and demand is counted in (spec section 8). */
import type { SearchHints } from '../../outreach/src/types.js';

export type Family = 'pier70_gigs' | 'sf_notaries' | 'ca_attorneys' | 'developers';

/** The YC office at Pier 70, the demo job's location (the same point as services/outreach/scripts/seed-team.ts). */
export const PIER70 = { lat: 37.7609, lng: -122.3875, address: 'Pier 70, San Francisco, CA' } as const;
/** On-site radius around Pier 70, km (services/outreach's default OUTREACH_RADIUS_KM). */
export const RADIUS_KM = 8;

export interface FamilySpec {
  key: Family;
  /** Invite copy: "The work: <label>." */
  label: string;
  /** Invite subject after "Join Operis: ". */
  subject: string;
  /** Lowest pre-vetted target, whatever demand says (spec section 9). */
  floor: number;
  remote: boolean;
  /** Title of the scratch job recruit_search hands to find_people. */
  searchTitle: string;
  hints: SearchHints;
}

export const FAMILIES: Record<Family, FamilySpec> = {
  pier70_gigs: {
    key: 'pier70_gigs',
    label: 'short on-site jobs around Pier 70 and Dogpatch in San Francisco: event help, photos, deliveries and errands',
    subject: 'short paid jobs near Pier 70, San Francisco',
    floor: 15,
    remote: false,
    searchTitle: 'Event help, photos and deliveries near Pier 70',
    hints: {
      roles: ['brand ambassador', 'event staff', 'street team member', 'event photographer', 'courier', 'errand runner'],
      skills: ['events', 'photography', 'delivery'],
      credential: null,
      remote: false,
    },
  },
  sf_notaries: {
    key: 'sf_notaries',
    label: 'mobile notary signings in San Francisco',
    subject: 'paid notary signings in San Francisco',
    floor: 5,
    remote: false,
    searchTitle: 'Mobile notary for a signing in San Francisco',
    hints: {
      roles: ['mobile notary', 'notary signing agent', 'loan signing agent', 'notary public'],
      skills: ['notary public', 'loan signings'],
      credential: 'notary public',
      remote: false,
    },
  },
  ca_attorneys: {
    key: 'ca_attorneys',
    label: 'short remote legal reviews for startups: contracts, terms of service and privacy',
    subject: 'short paid legal reviews (remote)',
    floor: 5,
    remote: true,
    searchTitle: 'Review a SaaS contract under California law',
    hints: {
      roles: ['contract attorney', 'technology attorney', 'startup lawyer'],
      skills: ['SaaS', 'contracts', 'privacy', 'terms of service'],
      credential: 'California bar license',
      remote: true,
    },
  },
  developers: {
    key: 'developers',
    label: 'short paid coding help for AI hackathon teams: Next.js, React and TypeScript',
    subject: 'short paid coding jobs for AI teams (remote)',
    floor: 10,
    remote: true,
    searchTitle: 'Fix a Next.js and TypeScript bug',
    hints: {
      roles: ['Next.js developer', 'React developer', 'TypeScript developer', 'full stack developer'],
      skills: ['Next.js', 'React', 'TypeScript', 'Vercel'],
      credential: null,
      remote: true,
    },
  },
};

export const FAMILY_KEYS = Object.keys(FAMILIES) as Family[];
export const isFamily = (v: unknown): v is Family => typeof v === 'string' && Object.prototype.hasOwnProperty.call(FAMILIES, v);
```

<!-- file: services/growth/src/types.ts -->
```ts
import type { Family } from './families.js';

export type ContactKind = 'prospect' | 'recruit';
export type MessageKind = 'marketing' | 'invite';
export type LogKind = MessageKind | 'search' | 'unsubscribe' | 'join' | 'identity' | 'suppress';
export type LogStatus = 'sent' | 'dry_run' | 'skipped' | 'failed' | 'ok';

/** Someone we may email: a hand-sourced prospect (Sales) or a recruit found by recruit_search (Recruiter). */
export interface Contact {
  id: string;
  kind: ContactKind;
  /** Lowercased. */
  email: string;
  name: string | null;
  org: string | null;
  family: Family | null;
  /** Recruits: workers.id in Andrew's pool. */
  worker_id: string | null;
  /** Quoted in every email: "How we found you: <found_via>." */
  found_via: string;
  notes: string | null;
  free_first_job: boolean;
  opted_out: boolean;
  joined_at: Date | null;
  /** Last real send (status sent) to this contact. */
  last_contacted_at: Date | null;
  created_at: Date;
}

export interface NewContact {
  kind: ContactKind;
  email: string;
  name?: string | null;
  org?: string | null;
  family?: Family | null;
  worker_id?: string | null;
  found_via: string;
  notes?: string | null;
  free_first_job?: boolean;
}

export interface LogEntry {
  contact_id?: string | null;
  kind: LogKind;
  status: LogStatus;
  reason?: string | null;
  family?: Family | null;
  cost_usd?: number;
  ref?: string | null;
}

/** A free-first-job grant (growth_promos). */
export interface Grant {
  id: string;
  contact_id: string;
  /** The company domain, or the full address at free-mail providers. */
  grant_key: string;
  cap_cents: number;
  expires_at: Date;
  redeemed_job_id: string | null;
  refund_cents: number | null;
  redeemed_at: Date | null;
  created_at: Date;
}

/** Read-only view of Edwin's jobs table, for demand. */
export interface JobRow {
  id: string;
  title: string;
  instructions: string;
  certification_required: string | null;
  lat: number | null;
  lng: number | null;
  remote: boolean;
  status: string;
  worker_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/** A job and its customer's contact (jobs + customers), for the free first job. */
export interface JobWithCustomer {
  job_id: string;
  customer_id: string | null;
  customer_name: string | null;
  /** Lowercased. */
  contact_email: string | null;
  budget_usd: number;
  status: string;
  created_at: Date;
}

/** Read-only view of Cameron's worker_verifications. */
export interface VerificationRow {
  worker_id: string;
  kind: string;
  status: string;
}
```

<!-- file: services/growth/src/templates.ts -->
```ts
/**
 * The two growth emails, plain text. Everything the law or our rules require is fixed here: who we are, that it is
 * marketing or an invitation, how we found the person, the postal address and a one-click unsubscribe link. The
 * Sales agent may add one personal line (cleanPersonalLine); the Recruiter adds nothing. First drafts of this copy
 * came from the local model and were rewritten line by line.
 */
import { greetingName } from '../../outreach/src/templates.js';
import { shortDate } from './time.js';

export interface EmailMessage {
  subject: string;
  text: string;
}

export const PERSONAL_LINE_MAX = 300;
/** Printed instead of the postal address on allowlisted test sends before GROWTH_POSTAL_ADDRESS is set. */
export const PENDING_ADDRESS = 'Postal address pending (test email to the Operis team)';

export const firstNameOf = (name: string | null): string | null => greetingName({ name, kind: 'person' });
const hello = (first: string | null) => `Hi ${first ?? 'there'},`;
const clause = (s: string) => s.replace(/[\s.]+$/, '');

export type CleanLine = { ok: true; line: string | null } | { ok: false; reason: 'personal_line_has_link' | 'personal_line_too_long' };

/** One line, no links, at most 300 characters. Empty input means no personal line. */
export function cleanPersonalLine(raw: string | null | undefined): CleanLine {
  const line = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!line) return { ok: true, line: null };
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|io|ai|dev|live|app|co|net|org|xyz|sh)\b/i.test(line)) return { ok: false, reason: 'personal_line_has_link' };
  if (line.length > PERSONAL_LINE_MAX) return { ok: false, reason: 'personal_line_too_long' };
  return { ok: true, line };
}

export interface MarketingCopy {
  firstName: string | null;
  personalLine: string | null;
  promo: { capUsd: number; expiresAt: Date } | null;
  foundVia: string;
  postalAddress: string | null;
  unsubscribeUrl: string;
}

export function renderMarketing(c: MarketingCopy): EmailMessage {
  const lines = [
    hello(c.firstName),
    '',
    ...(c.personalLine ? [c.personalLine, ''] : []),
    'Operis is a company run by AI agents. We send a real person to do real-world tasks for your agent: photograph or check a place, pick up and deliver an item, or be there for paperwork such as a notarization. Most on-site work is in San Francisco; some is remote, like contract review or coding help.',
    '',
    'Your agent calls one MCP tool, request_human. You pay only when the proof passes: we check every proof (photos, GPS and time) before charging. Jobs start at $20.',
    '',
    'Connect in a minute, no call needed:',
    '- Give your agent https://operis.live/SKILL.md',
    '- Or add the MCP server https://operis.live/mcp (you sign in in the browser)',
    '- Or get an API key at https://operis.live/developers',
    '',
    ...(c.promo
      ? [
          `Your team's first job is on us: we refund it in full, up to $${c.promo.capUsd}, once the proof passes. One per team; the offer ends ${shortDate(c.promo.expiresAt)}.`,
          '',
        ]
      : []),
    `How we found you: ${clause(c.foundVia)}.`,
    'This is a marketing email from Operis.',
    '',
    'Operis Sales (an AI agent) · operis.live',
    c.postalAddress ?? PENDING_ADDRESS,
    'Unsubscribe with one click and we will never email you again:',
    c.unsubscribeUrl,
  ];
  return { subject: 'Your agent can send a person to do real-world tasks', text: lines.join('\n') };
}

export interface InviteCopy {
  firstName: string | null;
  familyLabel: string;
  familySubject: string;
  joinUrl: string;
  foundVia: string;
  postalAddress: string | null;
  unsubscribeUrl: string;
}

export function renderInvite(c: InviteCopy): EmailMessage {
  const lines = [
    hello(c.firstName),
    '',
    'Operis is a company run by AI agents. We offer short, paid jobs from AI agents and businesses to people with the right skills.',
    '',
    `The work: ${clause(c.familyLabel)}.`,
    '',
    'Want job offers? Join with one click (no account, no fee):',
    c.joinUrl,
    '',
    'After joining you can verify your ID once with Stripe (about 2 minutes). Larger jobs and jobs that need a license require a verified ID.',
    '',
    'Every job shows its pay before you accept, and you are paid when the work is approved. Take only the jobs you want.',
    '',
    `How we found you: ${clause(c.foundVia)}.`,
    'This is an invitation from Operis.',
    '',
    'Operis · operis.live',
    c.postalAddress ?? PENDING_ADDRESS,
    'Unsubscribe with one click and we will never contact you again:',
    c.unsubscribeUrl,
  ];
  return { subject: `Join Operis: ${c.familySubject}`, text: lines.join('\n') };
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd services/growth && ../../node_modules/.bin/vitest run && ../../node_modules/.bin/tsc --noEmit`
Expected: 4 files pass; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/growth/src/families.ts services/growth/src/types.ts services/growth/src/templates.ts services/growth/test/templates.test.ts
git commit -m "growth: job families, shared types and the fixed marketing and invite copy"
```

---
### Task 3: Repository, dependencies, opt-outs and the guard

**Files:**
- Create: `services/growth/src/repo.ts`, `services/growth/src/repo/memory.ts`, `services/growth/src/deps.ts`, `services/growth/src/optout.ts`, `services/growth/src/guard.ts`
- Test: `services/growth/test/helpers.ts`, `services/growth/test/guard.test.ts`

**Interfaces:**
- Consumes: Task 1 and 2 types; Andrew's `Repo`, `Person`, `EmailSender`, `Monid`, `SourceAdapter`, `Enricher`, `InMemoryRepo`, `RecordingSender`.
- Produces: `GrowthRepo` (methods below), `GrowthTablesMissing`, `contactKindFor(kind)`; `MemoryGrowthRepo(clock?, newId?)` with public arrays `contacts`, `logs`, `grants`, `jobs`, `customers`, `verifications`; `GrowthDeps`; `isOptedOut(deps, email)`, `optOutEverywhere(deps, email) → { matched_contacts, matched_workers }`; `decide(deps, kind, email) → Decision`, `Decision`, `SkipReason`, `RECENT_DAYS = 30`, `dailyCap(env, kind)`. Test helpers: `NOW`, `TEAM`, `SECRET`, `testEnv`, `setup`, `prospect`, `recruitContact`, `offlineMonid`, `fakeSource`, `lead`.

- [ ] **Step 1: Write the test helpers and the failing guard test**

<!-- file: services/growth/test/helpers.ts -->
```ts
import type { Monid } from '../../outreach/src/monid.js';
import { InMemoryRepo } from '../../outreach/src/repo/memory.js';
import { RecordingSender } from '../../outreach/src/senders.js';
import type { SourceAdapter } from '../../outreach/src/sources/types.js';
import type { Lead } from '../../outreach/src/types.js';
import type { GrowthDeps } from '../src/deps.js';
import type { GrowthEnv } from '../src/env.js';
import { MemoryGrowthRepo } from '../src/repo/memory.js';
import type { Contact, NewContact } from '../src/types.js';

/** Sun Nov 8 2026, 10:00 Pacific. */
export const NOW = new Date('2026-11-08T18:00:00Z');
export const TEAM = 'team@operis.example';
export const SECRET = 'test-secret';

export function testEnv(over: Partial<GrowthEnv> = {}): GrowthEnv {
  return {
    PUBLIC_BASE_URL: 'https://operis.live',
    LINK_SIGNING_SECRET: SECRET,
    GROWTH_LIVE: [],
    GROWTH_PAUSE: false,
    OUTREACH_TEST_ALLOWLIST: [TEAM],
    GROWTH_POSTAL_ADDRESS: null,
    GROWTH_SALES_DAILY_CAP: 25,
    GROWTH_RECRUIT_DAILY_CAP: 40,
    GROWTH_SEARCH_DAILY_USD: 2,
    GROWTH_PROMO_MAX_GRANTS: 20,
    GROWTH_PROMO_CAP_USD: 25,
    GROWTH_PROMO_DAYS: 14,
    MONID_API_KEY: null,
    MONID_BASE_URL: 'https://api.monid.ai',
    NAIVE_API_KEY: null,
    NAIVE_BASE_URL: 'https://api.vetta.sh',
    GROWTH_SALES_NAIVE_IDENTITY_ID: null,
    GROWTH_SALES_NAIVE_INBOX_ID: null,
    GROWTH_SALES_AGENTMAIL_INBOX: null,
    GROWTH_RECRUIT_AGENTMAIL_INBOX: null,
    ...over,
  };
}

/** Everything in memory: a clock the test can move, recording senders and a fake Stripe Identity. */
export function setup(over: Partial<GrowthEnv> = {}) {
  let t = NOW.getTime();
  const now = () => new Date(t);
  const advance = (ms: number) => {
    t += ms;
  };
  const repo = new MemoryGrowthRepo(now);
  const pool = new InMemoryRepo();
  const sales = new RecordingSender();
  const recruit = new RecordingSender();
  const identityCalls: string[] = [];
  const deps: GrowthDeps = {
    env: testEnv(over),
    repo,
    pool,
    senders: { sales, recruit },
    now,
    identity: async (workerId) => {
      identityCalls.push(workerId);
      return { url: `https://verify.stripe.test/${workerId}`, status: 'pending' };
    },
  };
  return { deps, repo, pool, sales, recruit, now, advance, identityCalls };
}

export async function prospect(repo: MemoryGrowthRepo, over: Partial<NewContact> = {}): Promise<Contact> {
  const c = { kind: 'prospect' as const, email: 'jane@agentco.example', name: 'Jane Doe', org: 'AgentCo', found_via: 'the YC x Naïve hackathon team list', notes: 'Agent that books event venues', free_first_job: true, ...over };
  return (await repo.upsertContact(c)).contact;
}

/** A recruit already in Andrew's pool: a workers row plus its growth contact. */
export async function recruitContact(s: ReturnType<typeof setup>, email: string, over: Partial<NewContact> = {}): Promise<Contact> {
  const p = s.pool.addPerson({ email, name: 'Ada Lovelace', dedupe_key: `email:${email}`, headline: 'Next.js developer' });
  const c = { kind: 'recruit' as const, email, name: p.name, family: 'developers' as const, worker_id: p.id, found_via: 'your public GitHub profile', ...over };
  return (await s.repo.upsertContact(c)).contact;
}

/** A Monid that is never reachable: anything that really calls it records an error. */
export const offlineMonid: Monid = {
  run: async () => {
    throw new Error('offline (test)');
  },
};

export function fakeSource(leads: Lead[], cost = 0.01): SourceAdapter {
  return { id: 'fake:people', costEstimateUsd: cost, perQuery: false, run: async () => ({ leads: leads.map((l) => ({ ...l })), cost_usd: cost }) };
}

export function lead(over: Partial<Lead>): Lead {
  return {
    name: 'Ada Lovelace',
    kind: 'person',
    email: 'ada@devs.example',
    phone: null,
    website: null,
    profile_url: 'https://github.com/ada',
    address: null,
    lat: null,
    lng: null,
    source: 'fake:people',
    source_ref: 'ada',
    categories: ['React', 'Next.js'],
    rating: null,
    snippet: 'Freelance Next.js and React developer',
    profiles: [{ platform: 'github', url: 'https://github.com/ada', handle: 'ada' }],
    headline: 'Freelance Next.js and React developer',
    location_text: 'Remote',
    credentials: [],
    open_to_work: true,
    last_active_at: null,
    ...over,
  };
}
```

<!-- file: services/growth/test/guard.test.ts -->
```ts
import { describe, expect, it } from 'vitest';
import { decide } from '../src/guard.js';
import { DAY_MS } from '../src/time.js';
import { NOW, TEAM, prospect, setup } from './helpers.js';

const STRANGER = 'founder@agentco.example';
const ADDRESS = '1 Example St, San Francisco, CA 94100';

describe('decide', () => {
  it('dry-runs a stranger while not live and sends to the team allowlist as a test', async () => {
    const { deps } = setup();
    expect(await decide(deps, 'marketing', STRANGER)).toEqual({ action: 'dry_run' });
    expect(await decide(deps, 'invite', 'Team@Operis.example')).toEqual({ action: 'send', mode: 'test' });
  });

  it('sends to anyone only when that kind is live and a postal address is set', async () => {
    const live = { GROWTH_LIVE: ['sales' as const], GROWTH_POSTAL_ADDRESS: ADDRESS };
    expect(await decide(setup(live).deps, 'marketing', STRANGER)).toEqual({ action: 'send', mode: 'live' });
    expect(await decide(setup(live).deps, 'invite', STRANGER)).toEqual({ action: 'dry_run' });
    expect(await decide(setup({ GROWTH_LIVE: ['sales', 'recruit'] }).deps, 'marketing', STRANGER)).toEqual({ action: 'dry_run' });
  });

  it('skips everyone when paused, the allowlist included', async () => {
    expect(await decide(setup({ GROWTH_PAUSE: true }).deps, 'marketing', TEAM)).toEqual({ action: 'skip', reason: 'paused' });
  });

  it('skips an address opted out in growth or in the worker pool', async () => {
    const s = setup();
    await s.repo.optOutEmail(STRANGER, NOW);
    s.pool.addPerson({ email: 'gone@example.org', opted_out: true, dedupe_key: 'email:gone@example.org' });
    expect(await decide(s.deps, 'marketing', STRANGER)).toEqual({ action: 'skip', reason: 'opted_out' });
    expect(await decide(s.deps, 'invite', 'gone@example.org')).toEqual({ action: 'skip', reason: 'opted_out' });
  });

  it('skips an address sent to in the last 30 days, except the team allowlist', async () => {
    const s = setup();
    const c = await prospect(s.repo, { email: STRANGER });
    const team = await prospect(s.repo, { email: TEAM });
    await s.repo.markContacted(c.id, new Date(NOW.getTime() - 10 * DAY_MS));
    await s.repo.markContacted(team.id, new Date(NOW.getTime() - DAY_MS));
    expect(await decide(s.deps, 'marketing', STRANGER)).toEqual({ action: 'skip', reason: 'recently_contacted' });
    expect(await decide(s.deps, 'invite', STRANGER)).toEqual({ action: 'dry_run' });
    expect(await decide(s.deps, 'marketing', TEAM)).toEqual({ action: 'send', mode: 'test' });
    s.advance(21 * DAY_MS);
    expect(await decide(s.deps, 'marketing', STRANGER)).toEqual({ action: 'dry_run' });
  });

  it('skips once sends plus dry runs reach the daily cap, per kind, until the next Pacific day', async () => {
    const s = setup({ GROWTH_SALES_DAILY_CAP: 2 });
    await s.repo.log({ kind: 'marketing', status: 'sent' });
    await s.repo.log({ kind: 'marketing', status: 'dry_run' });
    await s.repo.log({ kind: 'marketing', status: 'skipped' });
    expect(await decide(s.deps, 'marketing', STRANGER)).toEqual({ action: 'skip', reason: 'daily_cap' });
    expect(await decide(s.deps, 'invite', STRANGER)).toEqual({ action: 'dry_run' });
    s.advance(DAY_MS);
    expect(await decide(s.deps, 'marketing', STRANGER)).toEqual({ action: 'dry_run' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd services/growth && ../../node_modules/.bin/vitest run test/guard.test.ts`
Expected: FAIL, cannot find `../src/repo/memory.js`.

- [ ] **Step 3: Implement**

<!-- file: services/growth/src/repo.ts -->
```ts
import type { Contact, ContactKind, Grant, JobRow, JobWithCustomer, LogEntry, MessageKind, NewContact, VerificationRow } from './types.js';

/**
 * Persistence for growth. Writes only the growth_* tables (migrations/0001_growth.sql); reads jobs and customers
 * (Edwin's) and worker_verifications (Cameron's). Pool rows (workers, worker_profiles) are written through
 * services/outreach's Repo, never here. MemoryGrowthRepo (tests, dry run) and PostgresGrowthRepo implement it.
 */
export interface GrowthRepo {
  /**
   * Insert or merge on (kind, email). Never clears opted_out, joined_at or last_contacted_at; fills empty fields.
   * A new row for an address that is opted out anywhere starts opted out.
   */
  upsertContact(c: NewContact): Promise<{ contact: Contact; created: boolean }>;
  getContact(id: string): Promise<Contact | null>;
  getRecruitByWorker(workerId: string): Promise<Contact | null>;
  /** Prospects not opted out and not sent to since `notSentSince`, oldest first. */
  listProspects(q: { limit: number; notSentSince: Date }): Promise<Contact[]>;
  listRecruits(): Promise<Contact[]>;
  markContacted(id: string, at: Date): Promise<void>;
  markJoined(id: string, at: Date): Promise<void>;
  /** Opt out every contact with this address; with none, store a suppression row. Returns the contacts matched. */
  optOutEmail(email: string, at: Date): Promise<number>;
  isSuppressed(email: string): Promise<boolean>;
  /** Latest real send to this address among contacts of this kind. */
  lastSentAt(email: string, kind: ContactKind): Promise<Date | null>;

  log(e: LogEntry): Promise<void>;
  messageCountsSince(kind: MessageKind, since: Date): Promise<{ sent: number; dry_run: number }>;
  searchSpendSince(since: Date): Promise<number>;

  getGrantByKey(key: string): Promise<Grant | null>;
  getGrantByJob(jobId: string): Promise<Grant | null>;
  countGrants(): Promise<number>;
  listGrants(): Promise<Grant[]>;
  /** Null when the key already has a grant. */
  insertGrant(g: { contact_id: string; grant_key: string; cap_cents: number; expires_at: Date }): Promise<Grant | null>;
  /** Set the redeemed job unless one is set already; returns the grant as stored afterwards (null if unknown). */
  reserveGrant(grantId: string, jobId: string, refundCents: number, at: Date): Promise<Grant | null>;

  listJobsSince(since: Date): Promise<JobRow[]>;
  listPaidJobs(): Promise<JobWithCustomer[]>;
  getJobWithCustomer(jobId: string): Promise<JobWithCustomer | null>;
  countPaidJobsBefore(customerId: string, before: Date, excludeJobId: string): Promise<number>;
  /** Empty when the table does not exist yet. */
  listVerifications(workerIds: string[]): Promise<VerificationRow[]>;
}

export class GrowthTablesMissing extends Error {
  constructor() {
    super('growth tables missing: run services/growth/migrations/0001_growth.sql');
    this.name = 'GrowthTablesMissing';
  }
}

export const contactKindFor = (kind: MessageKind): ContactKind => (kind === 'marketing' ? 'prospect' : 'recruit');
```

<!-- file: services/growth/src/repo/memory.ts -->
```ts
import { randomUUID } from 'node:crypto';
import type { GrowthRepo } from '../repo.js';
import type { Contact, ContactKind, Grant, JobRow, JobWithCustomer, LogEntry, MessageKind, NewContact, VerificationRow } from '../types.js';

type StoredJob = JobRow & { customer_id: string | null; budget_usd: number };

/** In-memory GrowthRepo (tests, scripts/dry-run.ts). Seed jobs, customers and verifications through the arrays. */
export class MemoryGrowthRepo implements GrowthRepo {
  readonly contacts: Contact[] = [];
  readonly logs: (LogEntry & { created_at: Date })[] = [];
  readonly grants: Grant[] = [];
  readonly jobs: StoredJob[] = [];
  readonly customers: { id: string; name: string | null; contact_email: string | null }[] = [];
  readonly verifications: VerificationRow[] = [];

  constructor(
    private readonly clock: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  async upsertContact(c: NewContact): Promise<{ contact: Contact; created: boolean }> {
    const email = c.email.trim().toLowerCase();
    const found = this.contacts.find((x) => x.kind === c.kind && x.email === email);
    if (found) {
      found.name ??= c.name ?? null;
      found.org ??= c.org ?? null;
      found.family ??= c.family ?? null;
      found.worker_id ??= c.worker_id ?? null;
      found.notes = c.notes ?? found.notes;
      found.free_first_job = found.free_first_job || Boolean(c.free_first_job);
      return { contact: { ...found }, created: false };
    }
    const contact: Contact = {
      id: this.newId(),
      kind: c.kind,
      email,
      name: c.name ?? null,
      org: c.org ?? null,
      family: c.family ?? null,
      worker_id: c.worker_id ?? null,
      found_via: c.found_via,
      notes: c.notes ?? null,
      free_first_job: Boolean(c.free_first_job),
      opted_out: this.contacts.some((x) => x.email === email && x.opted_out),
      joined_at: null,
      last_contacted_at: null,
      created_at: this.clock(),
    };
    this.contacts.push(contact);
    return { contact: { ...contact }, created: true };
  }

  async getContact(id: string): Promise<Contact | null> {
    const c = this.contacts.find((x) => x.id === id);
    return c ? { ...c } : null;
  }

  async getRecruitByWorker(workerId: string): Promise<Contact | null> {
    const c = this.contacts.find((x) => x.kind === 'recruit' && x.worker_id === workerId);
    return c ? { ...c } : null;
  }

  async listProspects(q: { limit: number; notSentSince: Date }): Promise<Contact[]> {
    return this.contacts
      .filter((c) => c.kind === 'prospect' && !c.opted_out && (!c.last_contacted_at || c.last_contacted_at < q.notSentSince))
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .slice(0, q.limit)
      .map((c) => ({ ...c }));
  }

  async listRecruits(): Promise<Contact[]> {
    return this.contacts.filter((c) => c.kind === 'recruit').map((c) => ({ ...c }));
  }

  async markContacted(id: string, at: Date): Promise<void> {
    const c = this.contacts.find((x) => x.id === id);
    if (c) c.last_contacted_at = at;
  }

  async markJoined(id: string, at: Date): Promise<void> {
    const c = this.contacts.find((x) => x.id === id);
    if (c) c.joined_at ??= at;
  }

  async optOutEmail(email: string, at: Date): Promise<number> {
    const e = email.trim().toLowerCase();
    const rows = this.contacts.filter((c) => c.email === e);
    for (const c of rows) c.opted_out = true;
    if (rows.length === 0) {
      this.contacts.push({
        id: this.newId(),
        kind: 'prospect',
        email: e,
        name: null,
        org: null,
        family: null,
        worker_id: null,
        found_via: 'suppressed: asked us to stop',
        notes: null,
        free_first_job: false,
        opted_out: true,
        joined_at: null,
        last_contacted_at: null,
        created_at: at,
      });
    }
    return rows.length;
  }

  async isSuppressed(email: string): Promise<boolean> {
    const e = email.trim().toLowerCase();
    return this.contacts.some((c) => c.email === e && c.opted_out);
  }

  async lastSentAt(email: string, kind: ContactKind): Promise<Date | null> {
    const e = email.trim().toLowerCase();
    const times = this.contacts
      .filter((c) => c.email === e && c.kind === kind && c.last_contacted_at)
      .map((c) => c.last_contacted_at!.getTime());
    return times.length ? new Date(Math.max(...times)) : null;
  }

  async log(e: LogEntry): Promise<void> {
    this.logs.push({ ...e, created_at: this.clock() });
  }

  async messageCountsSince(kind: MessageKind, since: Date): Promise<{ sent: number; dry_run: number }> {
    const rows = this.logs.filter((l) => l.kind === kind && l.created_at >= since);
    return { sent: rows.filter((l) => l.status === 'sent').length, dry_run: rows.filter((l) => l.status === 'dry_run').length };
  }

  async searchSpendSince(since: Date): Promise<number> {
    return this.logs.filter((l) => l.kind === 'search' && l.created_at >= since).reduce((sum, l) => sum + (l.cost_usd ?? 0), 0);
  }

  async getGrantByKey(key: string): Promise<Grant | null> {
    const g = this.grants.find((x) => x.grant_key === key);
    return g ? { ...g } : null;
  }

  async getGrantByJob(jobId: string): Promise<Grant | null> {
    const g = this.grants.find((x) => x.redeemed_job_id === jobId);
    return g ? { ...g } : null;
  }

  async countGrants(): Promise<number> {
    return this.grants.length;
  }

  async listGrants(): Promise<Grant[]> {
    return this.grants.map((g) => ({ ...g }));
  }

  async insertGrant(g: { contact_id: string; grant_key: string; cap_cents: number; expires_at: Date }): Promise<Grant | null> {
    if (this.grants.some((x) => x.grant_key === g.grant_key)) return null;
    const grant: Grant = { id: this.newId(), ...g, redeemed_job_id: null, refund_cents: null, redeemed_at: null, created_at: this.clock() };
    this.grants.push(grant);
    return { ...grant };
  }

  async reserveGrant(grantId: string, jobId: string, refundCents: number, at: Date): Promise<Grant | null> {
    const g = this.grants.find((x) => x.id === grantId);
    if (!g) return null;
    if (g.redeemed_job_id === null) Object.assign(g, { redeemed_job_id: jobId, refund_cents: refundCents, redeemed_at: at });
    return { ...g };
  }

  async listJobsSince(since: Date): Promise<JobRow[]> {
    return this.jobs.filter((j) => j.created_at >= since).map(({ customer_id: _c, budget_usd: _b, ...j }) => ({ ...j }));
  }

  async listPaidJobs(): Promise<JobWithCustomer[]> {
    return this.jobs.filter((j) => j.status === 'paid').map((j) => this.withCustomer(j));
  }

  async getJobWithCustomer(jobId: string): Promise<JobWithCustomer | null> {
    const j = this.jobs.find((x) => x.id === jobId);
    return j ? this.withCustomer(j) : null;
  }

  async countPaidJobsBefore(customerId: string, before: Date, excludeJobId: string): Promise<number> {
    return this.jobs.filter((j) => j.customer_id === customerId && j.status === 'paid' && j.created_at < before && j.id !== excludeJobId).length;
  }

  async listVerifications(workerIds: string[]): Promise<VerificationRow[]> {
    const ids = new Set(workerIds);
    return this.verifications.filter((v) => ids.has(v.worker_id)).map((v) => ({ ...v }));
  }

  private withCustomer(j: StoredJob): JobWithCustomer {
    const c = this.customers.find((x) => x.id === j.customer_id);
    return {
      job_id: j.id,
      customer_id: j.customer_id,
      customer_name: c?.name ?? null,
      contact_email: c?.contact_email?.toLowerCase() ?? null,
      budget_usd: j.budget_usd,
      status: j.status,
      created_at: j.created_at,
    };
  }
}
```

<!-- file: services/growth/src/deps.ts -->
```ts
import type { Monid } from '../../outreach/src/monid.js';
import type { Repo as PoolRepo } from '../../outreach/src/repo.js';
import type { EmailSender } from '../../outreach/src/senders.js';
import type { Enricher, SourceAdapter } from '../../outreach/src/sources/types.js';
import type { GrowthEnv } from './env.js';
import type { GrowthRepo } from './repo.js';

/** What every growth operation needs. services/growth/index.ts builds it for apps/api; tests build it by hand. */
export interface GrowthDeps {
  env: GrowthEnv;
  repo: GrowthRepo;
  /** Andrew's talent pool (workers + worker_profiles): save found people, opt in, opt out, look up by email. */
  pool: Pick<PoolRepo, 'upsertLead' | 'setRegular' | 'optOut' | 'findByContact'>;
  /** A missing sender makes that kind of real send fail with reason no_sender (dry runs still work). */
  senders: { sales?: EmailSender; recruit?: EmailSender };
  /** Needed by recruit_search only. */
  monid?: Monid;
  /** Cameron's Stripe Identity link (services/verify createIdentityLink); url null when already verified. */
  identity?: (workerId: string) => Promise<{ url: string | null; status: string }>;
  now: () => Date;
  /** Test overrides for recruit_search's people search. */
  search?: { sources?: SourceAdapter[]; enrichers?: Enricher[] };
}
```

<!-- file: services/growth/src/optout.ts -->
```ts
import type { GrowthDeps } from './deps.js';

/** Opted out in growth (any contact row with the address) or in Andrew's pool (workers.opted_out). */
export async function isOptedOut(deps: Pick<GrowthDeps, 'repo' | 'pool'>, email: string): Promise<boolean> {
  const addr = email.trim().toLowerCase();
  if (await deps.repo.isSuppressed(addr)) return true;
  return (await deps.pool.findByContact({ email: addr })).some((p) => p.opted_out);
}

/**
 * Stop all Operis email to an address, forever: every growth contact with it (or a suppression row when there is
 * none) and every workers row with it, through Andrew's optOut, so Ops' send_blast skips it too.
 */
export async function optOutEverywhere(
  deps: Pick<GrowthDeps, 'repo' | 'pool' | 'now'>,
  email: string,
): Promise<{ matched_contacts: number; matched_workers: number }> {
  const addr = email.trim().toLowerCase();
  const matched_contacts = await deps.repo.optOutEmail(addr, deps.now());
  const matched_workers = await deps.pool.optOut({ email: addr });
  return { matched_contacts, matched_workers };
}
```

<!-- file: services/growth/src/guard.ts -->
```ts
import type { GrowthDeps } from './deps.js';
import type { GrowthEnv } from './env.js';
import { isOptedOut } from './optout.js';
import { contactKindFor } from './repo.js';
import { DAY_MS, pacificDayStart } from './time.js';
import type { MessageKind } from './types.js';

export type SkipReason = 'paused' | 'opted_out' | 'recently_contacted' | 'daily_cap';
export type Decision = { action: 'send'; mode: 'live' | 'test' } | { action: 'dry_run' } | { action: 'skip'; reason: SkipReason };

/** No second message of the same kind to the same address within this many days. */
export const RECENT_DAYS = 30;

export const dailyCap = (env: GrowthEnv, kind: MessageKind): number =>
  kind === 'marketing' ? env.GROWTH_SALES_DAILY_CAP : env.GROWTH_RECRUIT_DAILY_CAP;

/**
 * May one marketing email or invite go to `email`, and how? The only place the sending rules live:
 * 1. paused → skip; 2. opted out anywhere → skip; 3. a real send of this kind in the last 30 days → skip (the team
 * allowlist is exempt so tests can repeat); 4. today's sends + dry runs at the cap → skip; 5. the kind is live and a
 * postal address is set → send; 6. allowlisted → send as a test; 7. otherwise → dry run (logged, nothing sent).
 */
export async function decide(deps: GrowthDeps, kind: MessageKind, email: string): Promise<Decision> {
  const { env, repo } = deps;
  const now = deps.now();
  const addr = email.trim().toLowerCase();
  if (env.GROWTH_PAUSE) return { action: 'skip', reason: 'paused' };
  if (await isOptedOut(deps, addr)) return { action: 'skip', reason: 'opted_out' };
  const allowlisted = env.OUTREACH_TEST_ALLOWLIST.includes(addr);
  const last = await repo.lastSentAt(addr, contactKindFor(kind));
  if (!allowlisted && last && now.getTime() - last.getTime() < RECENT_DAYS * DAY_MS) return { action: 'skip', reason: 'recently_contacted' };
  const used = await repo.messageCountsSince(kind, pacificDayStart(now));
  if (used.sent + used.dry_run >= dailyCap(env, kind)) return { action: 'skip', reason: 'daily_cap' };
  const liveKind = kind === 'marketing' ? 'sales' : 'recruit';
  if (env.GROWTH_LIVE.includes(liveKind) && env.GROWTH_POSTAL_ADDRESS) return { action: 'send', mode: 'live' };
  if (allowlisted) return { action: 'send', mode: 'test' };
  return { action: 'dry_run' };
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd services/growth && ../../node_modules/.bin/vitest run && ../../node_modules/.bin/tsc --noEmit`
Expected: 5 files pass; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/growth/src/repo.ts services/growth/src/repo/memory.ts services/growth/src/deps.ts services/growth/src/optout.ts services/growth/src/guard.ts services/growth/test/helpers.ts services/growth/test/guard.test.ts
git commit -m "growth: repository, opt-outs and the guard that holds every sending rule"
```

---

### Task 4: Sales tools and free-first-job grants

**Files:**
- Create: `services/growth/src/deliver.ts`, `services/growth/src/promo.ts`, `services/growth/src/sales.ts`
- Test: `services/growth/test/sales.test.ts`

**Interfaces:**
- Consumes: `decide`, `RECENT_DAYS`, `optOutEverywhere`, `signLink`, `unsubscribeUrl`, `renderMarketing`, `cleanPersonalLine`, `firstNameOf`; Andrew's `normEmail`, `SendResult`, `EmailSender`.
- Produces: `SendStatus`, `Outcome`, `logSkip(deps, contact, kind, reason, family?)`, `deliver(deps, {...}) → Outcome`; `grantKeyFor(email)`, `PromoCheck`, `checkPromo(deps, contact)`, `recordGrant(deps, contact, check)`; `ProspectView`, `listProspects(deps, { limit? }) → { prospects, used_today, daily_cap }`, `SendMarketingResult`, `sendMarketing(deps, { contact_id, personal_line?, offer_free_first_job? })`, `suppressContact(deps, { email, reason })`.

- [ ] **Step 1: Write the failing test**

<!-- file: services/growth/test/sales.test.ts -->
```ts
import { describe, expect, it } from 'vitest';
import { decide } from '../src/guard.js';
import { listProspects, sendMarketing, suppressContact } from '../src/sales.js';
import { DAY_MS } from '../src/time.js';
import { NOW, TEAM, prospect, recruitContact, setup } from './helpers.js';

describe('list_prospects', () => {
  it('lists prospects not yet emailed, without their full address', async () => {
    const s = setup();
    const c = await prospect(s.repo);
    const r = await listProspects(s.deps);
    expect(r).toEqual({
      prospects: [{ contact_id: c.id, name: 'Jane Doe', org: 'AgentCo', email_domain: 'agentco.example', notes: 'Agent that books event venues', found_via: 'the YC x Naïve hackathon team list', free_first_job: true }],
      used_today: 0,
      daily_cap: 25,
    });
    expect(JSON.stringify(r)).not.toContain('jane@');
  });
});

describe('send_marketing', () => {
  it('dry-runs a prospect outside the allowlist: nothing sent, no grant, not marked contacted', async () => {
    const s = setup();
    const c = await prospect(s.repo);
    expect(await sendMarketing(s.deps, { contact_id: c.id, offer_free_first_job: true })).toEqual({ contact_id: c.id, status: 'dry_run', promo: { granted: false, reason: 'dry_run' } });
    expect(s.sales.sent).toHaveLength(0);
    expect(s.repo.grants).toHaveLength(0);
    expect((await s.repo.getContact(c.id))!.last_contacted_at).toBeNull();
    expect(s.repo.logs.map((l) => [l.kind, l.status])).toEqual([['marketing', 'dry_run']]);
  });

  it('sends to the allowlisted team address, marks it contacted and records the grant', async () => {
    const s = setup();
    const c = await prospect(s.repo, { email: TEAM, name: 'Team Tester' });
    const r = await sendMarketing(s.deps, { contact_id: c.id, personal_line: 'Your venue agent could send someone to check a room.', offer_free_first_job: true });
    expect(r).toEqual({ contact_id: c.id, status: 'sent', promo: { granted: true, cap_usd: 25, expires_at: new Date(NOW.getTime() + 14 * DAY_MS).toISOString() } });
    expect(s.sales.sent).toHaveLength(1);
    const m = s.sales.sent[0]!;
    expect(m.to).toBe(TEAM);
    expect(m.body).toContain('Hi Team,');
    expect(m.body).toContain('Your venue agent could send someone to check a room.');
    expect(m.body).toContain("Your team's first job is on us");
    expect(m.body).toMatch(/https:\/\/operis\.live\/v1\/growth\/unsubscribe\?t=u\./);
    expect((await s.repo.getContact(c.id))!.last_contacted_at).toEqual(NOW);
    expect(s.repo.grants.map((g) => g.grant_key)).toEqual(['operis.example']);
    expect(s.repo.logs.at(-1)).toMatchObject({ kind: 'marketing', status: 'sent', reason: 'allowlist' });
  });

  it('gives one grant per company domain and at most GROWTH_PROMO_MAX_GRANTS', async () => {
    const s = setup({ OUTREACH_TEST_ALLOWLIST: ['a@one.example', 'b@one.example', 'c@two.example'], GROWTH_PROMO_MAX_GRANTS: 1 });
    const send = async (email: string) => sendMarketing(s.deps, { contact_id: (await prospect(s.repo, { email })).id, offer_free_first_job: true });
    expect((await send('a@one.example')).promo).toMatchObject({ granted: true });
    expect(await send('b@one.example')).toMatchObject({ status: 'sent', promo: { granted: false, reason: 'already_granted' } });
    expect(await send('c@two.example')).toMatchObject({ status: 'sent', promo: { granted: false, reason: 'max_grants' } });
    expect(s.sales.sent.map((m) => m.body.includes('first job is on us'))).toEqual([true, false, false]);
  });

  it('never offers the free first job to a prospect not marked for it', async () => {
    const s = setup();
    const c = await prospect(s.repo, { email: TEAM, free_first_job: false });
    expect((await sendMarketing(s.deps, { contact_id: c.id, offer_free_first_job: true })).promo).toEqual({ granted: false, reason: 'not_eligible' });
    expect(s.sales.sent[0]!.body).not.toContain('first job is on us');
  });

  it('refuses ids that are not prospects and personal lines with links', async () => {
    const s = setup();
    const r = await recruitContact(s, 'ada@devs.example');
    expect(await sendMarketing(s.deps, { contact_id: r.id })).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/^not_a_prospect/) });
    expect(await sendMarketing(s.deps, { contact_id: 'nope' })).toMatchObject({ status: 'skipped' });
    const c = await prospect(s.repo, { email: TEAM });
    expect(await sendMarketing(s.deps, { contact_id: c.id, personal_line: 'see agentco.dev' })).toMatchObject({ status: 'skipped', reason: 'personal_line_has_link' });
    expect(s.sales.sent).toHaveLength(0);
  });

  it('fails cleanly, sending nothing, when no sender is configured', async () => {
    const s = setup();
    s.deps.senders = {};
    const c = await prospect(s.repo, { email: TEAM });
    expect(await sendMarketing(s.deps, { contact_id: c.id })).toMatchObject({ status: 'failed', reason: expect.stringMatching(/^no_sender/) });
    expect((await s.repo.getContact(c.id))!.last_contacted_at).toBeNull();
  });
});

describe('suppress_contact', () => {
  it('opts the address out of growth and of Ops outreach, even with no contact row yet', async () => {
    const s = setup();
    s.pool.addPerson({ email: 'x@agentco.example', dedupe_key: 'email:x@agentco.example' });
    expect(await suppressContact(s.deps, { email: 'X@AgentCo.example', reason: 'replied: please stop' })).toEqual({ suppressed: true, matched_contacts: 0, matched_workers: 1 });
    expect([...s.pool.people.values()][0]!.opted_out).toBe(true);
    expect(await decide(s.deps, 'marketing', 'x@agentco.example')).toEqual({ action: 'skip', reason: 'opted_out' });
    expect((await prospect(s.repo, { email: 'x@agentco.example' })).opted_out).toBe(true); // a later CSV import
  });

  it('rejects something that is not an email address', async () => {
    await expect(suppressContact(setup().deps, { email: 'not an email', reason: 'x' })).rejects.toThrow(/not an email/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd services/growth && ../../node_modules/.bin/vitest run test/sales.test.ts`
Expected: FAIL, cannot find `../src/sales.js`.

- [ ] **Step 3: Implement**

<!-- file: services/growth/src/deliver.ts -->
```ts
import type { EmailSender, SendResult } from '../../outreach/src/senders.js';
import type { GrowthDeps } from './deps.js';
import type { Family } from './families.js';
import type { Decision } from './guard.js';
import type { EmailMessage } from './templates.js';
import type { Contact, MessageKind } from './types.js';

export type SendStatus = 'sent' | 'dry_run' | 'skipped' | 'failed';
export interface Outcome {
  status: SendStatus;
  reason?: string;
}

/** Record a guard skip. */
export async function logSkip(deps: GrowthDeps, c: Contact, kind: MessageKind, reason: string, family: Family | null = null): Promise<Outcome> {
  await deps.repo.log({ contact_id: c.id, kind, status: 'skipped', reason, family });
  return { status: 'skipped', reason };
}

/** Carry out a send or dry-run decision and log it. Only a real send marks the contact as contacted. */
export async function deliver(
  deps: GrowthDeps,
  a: {
    contact: Contact;
    kind: MessageKind;
    family?: Family | null;
    decision: Exclude<Decision, { action: 'skip' }>;
    message: EmailMessage;
    sender: EmailSender | undefined;
    senderHint: string;
  },
): Promise<Outcome> {
  const base = { contact_id: a.contact.id, kind: a.kind, family: a.family ?? null };
  if (a.decision.action === 'dry_run') {
    await deps.repo.log({ ...base, status: 'dry_run' });
    return { status: 'dry_run' };
  }
  if (!a.sender) {
    await deps.repo.log({ ...base, status: 'failed', reason: 'no_sender' });
    return { status: 'failed', reason: `no_sender: ${a.senderHint}` };
  }
  const res: SendResult = await a.sender
    .send(a.contact.email, a.message.subject, a.message.text)
    .catch((e: unknown): SendResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  if (!res.ok) {
    const reason = (res.error ?? 'send failed').slice(0, 300);
    await deps.repo.log({ ...base, status: 'failed', reason });
    return { status: 'failed', reason };
  }
  await deps.repo.markContacted(a.contact.id, deps.now());
  await deps.repo.log({ ...base, status: 'sent', reason: a.decision.mode === 'test' ? 'allowlist' : null, ref: res.ref ?? null });
  return { status: 'sent' };
}
```

<!-- file: services/growth/src/promo.ts -->
```ts
/** The free first job: who may get a grant (spec section 11). Redemption is in redeem.ts. */
import type { GrowthDeps } from './deps.js';
import { DAY_MS } from './time.js';
import type { Contact, Grant } from './types.js';

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'icloud.com', 'me.com',
  'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'hey.com', 'fastmail.com',
]);

/** One grant per team: the company domain, or the whole address at free-mail providers. */
export function grantKeyFor(email: string): string {
  const e = email.trim().toLowerCase();
  const domain = e.split('@')[1] ?? '';
  return !domain || FREE_MAIL.has(domain) ? e : domain;
}

export type PromoCheck = { ok: true; capUsd: number; expiresAt: Date } | { ok: false; reason: 'not_eligible' | 'already_granted' | 'max_grants' };

/** Could this prospect get the free first job now? Writes nothing: the grant is recorded only after the email goes out. */
export async function checkPromo(deps: GrowthDeps, c: Contact): Promise<PromoCheck> {
  if (!c.free_first_job) return { ok: false, reason: 'not_eligible' };
  if (await deps.repo.getGrantByKey(grantKeyFor(c.email))) return { ok: false, reason: 'already_granted' };
  if ((await deps.repo.countGrants()) >= deps.env.GROWTH_PROMO_MAX_GRANTS) return { ok: false, reason: 'max_grants' };
  return { ok: true, capUsd: deps.env.GROWTH_PROMO_CAP_USD, expiresAt: new Date(deps.now().getTime() + deps.env.GROWTH_PROMO_DAYS * DAY_MS) };
}

/** Record the grant for an email that really went out. Null when a parallel call took the key first. */
export function recordGrant(deps: GrowthDeps, c: Contact, check: Extract<PromoCheck, { ok: true }>): Promise<Grant | null> {
  return deps.repo.insertGrant({ contact_id: c.id, grant_key: grantKeyFor(c.email), cap_cents: Math.round(check.capUsd * 100), expires_at: check.expiresAt });
}
```

<!-- file: services/growth/src/sales.ts -->
```ts
/** The Sales agent's tools: list_prospects, send_marketing, suppress_contact. */
import { normEmail } from '../../outreach/src/geo.js';
import { deliver, logSkip, type SendStatus } from './deliver.js';
import type { GrowthDeps } from './deps.js';
import { decide, RECENT_DAYS } from './guard.js';
import { signLink, unsubscribeUrl } from './links.js';
import { optOutEverywhere } from './optout.js';
import { checkPromo, recordGrant, type PromoCheck } from './promo.js';
import { cleanPersonalLine, firstNameOf, renderMarketing } from './templates.js';
import { DAY_MS, pacificDayStart } from './time.js';

export interface ProspectView {
  contact_id: string;
  name: string | null;
  org: string | null;
  email_domain: string;
  notes: string | null;
  found_via: string;
  free_first_job: boolean;
}

export async function listProspects(deps: GrowthDeps, input: { limit?: number } = {}): Promise<{ prospects: ProspectView[]; used_today: number; daily_cap: number }> {
  const now = deps.now();
  const limit = Math.min(50, Math.max(1, Math.floor(input.limit ?? 20)));
  const rows = await deps.repo.listProspects({ limit, notSentSince: new Date(now.getTime() - RECENT_DAYS * DAY_MS) });
  const today = await deps.repo.messageCountsSince('marketing', pacificDayStart(now));
  return {
    prospects: rows.map((c) => ({
      contact_id: c.id,
      name: c.name,
      org: c.org,
      email_domain: c.email.split('@')[1] ?? '',
      notes: c.notes,
      found_via: c.found_via,
      free_first_job: c.free_first_job,
    })),
    used_today: today.sent + today.dry_run,
    daily_cap: deps.env.GROWTH_SALES_DAILY_CAP,
  };
}

export interface SendMarketingResult {
  contact_id: string;
  status: SendStatus;
  reason?: string;
  promo?: { granted: boolean; cap_usd?: number; expires_at?: string; reason?: string };
}

const SALES_SENDER_HINT = 'set GROWTH_SALES_NAIVE_IDENTITY_ID + GROWTH_SALES_NAIVE_INBOX_ID, or GROWTH_SALES_AGENTMAIL_INBOX';

export async function sendMarketing(
  deps: GrowthDeps,
  input: { contact_id: string; personal_line?: string; offer_free_first_job?: boolean },
): Promise<SendMarketingResult> {
  const { env, repo } = deps;
  const id = input.contact_id;
  const line = cleanPersonalLine(input.personal_line);
  if (!line.ok) return { contact_id: id, status: 'skipped', reason: line.reason };
  const c = await repo.getContact(id);
  if (!c || c.kind !== 'prospect') return { contact_id: id, status: 'skipped', reason: 'not_a_prospect: use contact_id from list_prospects' };

  const decision = await decide(deps, 'marketing', c.email);
  if (decision.action === 'skip') return { contact_id: c.id, ...(await logSkip(deps, c, 'marketing', decision.reason)) };

  const offer: PromoCheck | null = input.offer_free_first_job ? await checkPromo(deps, c) : null;
  const message = renderMarketing({
    firstName: firstNameOf(c.name),
    personalLine: line.line,
    promo: offer?.ok ? { capUsd: offer.capUsd, expiresAt: offer.expiresAt } : null,
    foundVia: c.found_via,
    postalAddress: env.GROWTH_POSTAL_ADDRESS,
    unsubscribeUrl: unsubscribeUrl(env.PUBLIC_BASE_URL, signLink(env.LINK_SIGNING_SECRET, 'unsubscribe', c.id, deps.now())),
  });
  const out = await deliver(deps, { contact: c, kind: 'marketing', decision, message, sender: deps.senders.sales, senderHint: SALES_SENDER_HINT });
  const result: SendMarketingResult = { contact_id: c.id, ...out };
  if (!offer) return result;
  if (!offer.ok) return { ...result, promo: { granted: false, reason: offer.reason } };
  if (out.status !== 'sent') return { ...result, promo: { granted: false, reason: out.status === 'dry_run' ? 'dry_run' : 'not_sent' } };
  const grant = await recordGrant(deps, c, offer);
  return {
    ...result,
    promo: grant ? { granted: true, cap_usd: offer.capUsd, expires_at: offer.expiresAt.toISOString() } : { granted: false, reason: 'already_granted' },
  };
}

export async function suppressContact(
  deps: GrowthDeps,
  input: { email: string; reason: string },
): Promise<{ suppressed: true; matched_contacts: number; matched_workers: number }> {
  const email = normEmail(input.email);
  if (!email) throw new Error('suppress_contact: not an email address');
  const matched = await optOutEverywhere(deps, email);
  await deps.repo.log({ kind: 'suppress', status: 'ok', reason: (input.reason ?? '').slice(0, 200) || null });
  return { suppressed: true, ...matched };
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd services/growth && ../../node_modules/.bin/vitest run && ../../node_modules/.bin/tsc --noEmit`
Expected: 6 files pass; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/growth/src/deliver.ts services/growth/src/promo.ts services/growth/src/sales.ts services/growth/test/sales.test.ts
git commit -m "growth: Sales tools (list_prospects, send_marketing, suppress_contact) and free-first-job grants"
```

---

### Task 5: Recruiter tools

**Files:**
- Create: `services/growth/src/recruit.ts`
- Test: `services/growth/test/recruit.test.ts`

**Interfaces:**
- Consumes: Andrew's `findPeopleDetailed`, `FindDetailed`, `InMemoryRepo`, `personEnrichers`, `linkedinWorkEmail`, `Env`, `Lead`, `Person`; `deliver`, `logSkip`, `decide`, `RECENT_DAYS`, `isOptedOut`, `signLink`, `joinUrl`, `unsubscribeUrl`, `renderInvite`, `firstNameOf`, `FAMILIES`, `PIER70`, `RADIUS_KM`.
- Produces: `SEARCH_CALL_USD = 0.5`, `recruitEnrichers()`, `describeFound(person)`, `RecruitCandidate`, `RecruitSearchResult`, `recruitSearch(deps, { family, limit? })`, `InviteResult`, `RecruitInviteResult`, `recruitInvite(deps, { family, person_ids })`.

- [ ] **Step 1: Write the failing test**

<!-- file: services/growth/test/recruit.test.ts -->
```ts
import { describe, expect, it } from 'vitest';
import { personEnrichers } from '../../outreach/src/enrich/index.js';
import { LINKEDIN_WORK_EMAIL_ID } from '../../outreach/src/enrich/linkedinWorkEmail.js';
import { describeFound, recruitEnrichers, recruitInvite, recruitSearch } from '../src/recruit.js';
import { TEAM, fakeSource, lead, offlineMonid, recruitContact, setup } from './helpers.js';

const LEADS = [
  lead({}),
  lead({ name: 'No Email', email: null, source_ref: 'noemail', profile_url: 'https://github.com/noemail', profiles: [{ platform: 'github', url: 'https://github.com/noemail' }] }),
  lead({ name: 'Acme Dev Shop', kind: 'business', email: 'hello@acmedev.example', source_ref: 'acme', profile_url: null, profiles: [], website: 'https://acmedev.example' }),
];

function searching() {
  const s = setup();
  s.deps.monid = offlineMonid;
  s.deps.search = { sources: [fakeSource(LEADS)], enrichers: [] };
  return s;
}

describe('recruit_search', () => {
  it('saves individuals with a public email to the pool and returns them as candidates', async () => {
    const s = searching();
    const r = await recruitSearch(s.deps, { family: 'developers' });
    expect(r.candidates.map((c) => c.name)).toEqual(['Ada Lovelace']);
    expect(r).toMatchObject({ family: 'developers', new: 1, spend_usd: 0.01, spend_today_usd: 0.01, daily_cap_usd: 2 });
    expect([...s.pool.people.values()].map((p) => p.email)).toEqual(['ada@devs.example']);
    expect(s.repo.contacts).toMatchObject([
      { kind: 'recruit', email: 'ada@devs.example', family: 'developers', found_via: 'your public GitHub profile, where you list "Freelance Next.js and React developer"' },
    ]);
    expect(s.repo.logs).toMatchObject([{ kind: 'search', status: 'ok', family: 'developers', cost_usd: 0.01 }]);
  });

  it('finds the same person again without a second contact or pool row', async () => {
    const s = searching();
    await recruitSearch(s.deps, { family: 'developers' });
    expect((await recruitSearch(s.deps, { family: 'developers' })).new).toBe(0);
    expect(s.repo.contacts).toHaveLength(1);
    expect(s.pool.people.size).toBe(1);
  });

  it('leaves out anyone invited in the last 30 days or opted out', async () => {
    const s = searching();
    await recruitSearch(s.deps, { family: 'developers' });
    await s.repo.markContacted(s.repo.contacts[0]!.id, s.now());
    expect((await recruitSearch(s.deps, { family: 'developers' })).candidates).toEqual([]);
    const t = searching();
    await t.repo.optOutEmail('ada@devs.example', t.now());
    expect((await recruitSearch(t.deps, { family: 'developers' })).candidates).toEqual([]);
  });

  it('never uses the paid ContactOut work-email lookup', () => {
    expect(recruitEnrichers().map((e) => e.id)).not.toContain(LINKEDIN_WORK_EMAIL_ID);
    expect(recruitEnrichers()).toHaveLength(personEnrichers.length - 1);
  });

  it('stops at the daily search budget without calling anything', async () => {
    const s = setup();
    await s.repo.log({ kind: 'search', status: 'ok', cost_usd: 2 });
    expect(await recruitSearch(s.deps, { family: 'sf_notaries' })).toMatchObject({ found: 0, error: 'daily_search_budget_used', spend_today_usd: 2 });
  });

  it('needs a Monid key to search', async () => {
    await expect(recruitSearch(setup().deps, { family: 'developers' })).rejects.toThrow(/MONID_API_KEY/);
  });

  it('says where we found someone', () => {
    expect(describeFound({ profiles: [], headline: null })).toBe('your public profile online');
    expect(describeFound({ profiles: [{ platform: 'linkedin', url: 'x' }], headline: 'Mobile notary' })).toBe('your public LinkedIn profile, where you list "Mobile notary"');
  });
});

describe('recruit_invite', () => {
  it('sends a test invite to the allowlist, dry-runs a stranger and skips unknown ids', async () => {
    const s = setup();
    const team = await recruitContact(s, TEAM);
    const stranger = await recruitContact(s, 'ada@devs.example');
    const r = await recruitInvite(s.deps, { family: 'developers', person_ids: [team.worker_id!, stranger.worker_id!, '00000000-0000-4000-8000-000000000000'] });
    expect(r).toMatchObject({ sent: 1, dry_run: 1, skipped: 1, failed: 0, used_today: 2, daily_cap: 40 });
    expect(s.recruit.sent.map((m) => m.to)).toEqual([TEAM]);
    const m = s.recruit.sent[0]!;
    expect(m.subject).toBe('Join Operis: short paid coding jobs for AI teams (remote)');
    expect(m.body).toMatch(/https:\/\/operis\.live\/v1\/growth\/join\?t=j\./);
    expect(m.body).toContain('How we found you: your public GitHub profile.');
    expect(s.repo.logs.filter((l) => l.kind === 'invite').map((l) => l.status)).toEqual(['sent', 'dry_run']);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd services/growth && ../../node_modules/.bin/vitest run test/recruit.test.ts`
Expected: FAIL, cannot find `../src/recruit.js`.

- [ ] **Step 3: Implement**

<!-- file: services/growth/src/recruit.ts -->
```ts
/** The Recruiter's tools: recruit_search (find and save people for a family) and recruit_invite. */
import { linkedinWorkEmail, personEnrichers } from '../../outreach/src/enrich/index.js';
import type { Env as OutreachEnv } from '../../outreach/src/env.js';
import { findPeopleDetailed, type FindDetailed } from '../../outreach/src/find.js';
import { InMemoryRepo } from '../../outreach/src/repo/memory.js';
import type { Enricher } from '../../outreach/src/sources/types.js';
import type { Lead, Person } from '../../outreach/src/types.js';
import { deliver, logSkip, type Outcome, type SendStatus } from './deliver.js';
import type { GrowthDeps } from './deps.js';
import type { GrowthEnv } from './env.js';
import { FAMILIES, PIER70, RADIUS_KM, type Family, type FamilySpec } from './families.js';
import { decide, RECENT_DAYS } from './guard.js';
import { joinUrl, signLink, unsubscribeUrl } from './links.js';
import { isOptedOut } from './optout.js';
import { firstNameOf, renderInvite } from './templates.js';
import { DAY_MS, pacificDayStart } from './time.js';

/** One search never spends more than this, nor more than what is left of today's budget. */
export const SEARCH_CALL_USD = 0.5;
/** Candidates saved per search, to keep one call inside the internal MCP route's 60 s. */
const SAVE_MAX = 30;
const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** Andrew's person enrichers without ContactOut's paid LinkedIn work-email lookup: a bought contact, not a published one. */
export function recruitEnrichers(): Enricher[] {
  return personEnrichers.filter((e) => e.id !== linkedinWorkEmail.id);
}

/** Andrew's Env for a search that can never send anything. */
function searchEnv(g: GrowthEnv, maxSpendUsd: number): OutreachEnv {
  return {
    MONID_API_KEY: g.MONID_API_KEY ?? '',
    MONID_BASE_URL: g.MONID_BASE_URL,
    PUBLIC_BASE_URL: g.PUBLIC_BASE_URL,
    LINK_SIGNING_SECRET: g.LINK_SIGNING_SECRET,
    NAIVE_BASE_URL: g.NAIVE_BASE_URL,
    OUTREACH_MAX_SPEND_USD: maxSpendUsd,
    OUTREACH_RADIUS_KM: RADIUS_KM,
    OUTREACH_LIVE: false,
    OUTREACH_TEST_ALLOWLIST: [],
    PAUSE_OUTREACH: true,
    OUTREACH_MANUAL_DAILY_CAP: 0,
    OUTREACH_MANUAL_QUEUE: false,
    OUTREACH_TIME_BUDGET_MS: 40_000,
    OUTREACH_CALL_TIMEOUT_MS: 12_000,
    OUTREACH_ENRICH_CONCURRENCY: 8,
  };
}

const PLATFORM: Record<string, string> = {
  linkedin: 'LinkedIn profile',
  github: 'GitHub profile',
  x: 'X profile',
  reddit: 'Reddit profile',
  instagram: 'Instagram profile',
  directory: 'directory listing',
  website: 'website',
};
const ORDER = ['linkedin', 'github', 'x', 'reddit', 'instagram', 'directory', 'website'];

/** The invite's "How we found you" line, e.g. `your public GitHub profile, where you list "…"`. */
export function describeFound(p: Pick<Person, 'profiles' | 'headline'>): string {
  const on = ORDER.map((pl) => (p.profiles ?? []).find((x) => x.platform === pl)).find((x) => x !== undefined);
  const base = on ? `your public ${PLATFORM[on.platform]}` : 'your public profile online';
  const head = (p.headline ?? '').replace(/\s+/g, ' ').trim();
  return head ? `${base}, where you list "${head.length > 80 ? `${head.slice(0, 79)}…` : head}"` : base;
}

/** A pool lead from a scratch person. No phone: recruits are never texted. */
function toLead(p: Person): Lead {
  return {
    name: p.name,
    kind: p.kind,
    email: p.email,
    phone: null,
    website: p.website,
    profile_url: p.profile_url,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    source: p.source ?? 'growth:recruit_search',
    source_ref: null,
    categories: p.categories,
    rating: p.rating,
    snippet: p.snippet,
    profiles: p.profiles,
    headline: p.headline,
    location_text: p.location_text,
    credentials: p.credentials,
    open_to_work: p.open_to_work,
    last_active_at: p.last_active_at,
  };
}

export interface RecruitCandidate {
  person_id: string;
  name: string | null;
  headline: string | null;
  source: string;
  score: number;
  distance_km: number | null;
}

export interface RecruitSearchResult {
  family: Family;
  found: number;
  new: number;
  spend_usd: number;
  spend_today_usd: number;
  daily_cap_usd: number;
  error?: string;
  candidates: RecruitCandidate[];
}

/**
 * Find individuals for a family (Andrew's find_people on a scratch job at Pier 70, or remote), save the ones with a
 * public work email to the pool and as recruit contacts, and return the best ones not opted out or invited in 30 days.
 */
export async function recruitSearch(deps: GrowthDeps, input: { family: Family; limit?: number }): Promise<RecruitSearchResult> {
  const { env, repo } = deps;
  const spec = FAMILIES[input.family];
  const limit = Math.min(20, Math.max(1, Math.floor(input.limit ?? 10)));
  const now = deps.now();
  const spentBefore = await repo.searchSpendSince(pacificDayStart(now));
  const head = { family: spec.key, daily_cap_usd: env.GROWTH_SEARCH_DAILY_USD };
  const room = env.GROWTH_SEARCH_DAILY_USD - spentBefore;
  if (room < 0.01) return { ...head, found: 0, new: 0, spend_usd: 0, spend_today_usd: round(spentBefore), candidates: [], error: 'daily_search_budget_used' };
  if (!deps.monid) throw new Error('recruit_search: MONID_API_KEY is not set');

  const scratch = new InMemoryRepo();
  const jobId = `recruit-${spec.key}`;
  scratch.addJob({
    id: jobId,
    title: spec.searchTitle,
    instructions: spec.label,
    address: spec.remote ? null : PIER70.address,
    lat: spec.remote ? null : PIER70.lat,
    lng: spec.remote ? null : PIER70.lng,
    deadline: null,
    budget_usd: 60,
    worker_pay_usd: null,
    certification_required: spec.hints.credential ?? null,
    remote: spec.remote,
    status: 'held',
  });

  let res: FindDetailed | null = null;
  let error: string | null = null;
  try {
    res = await findPeopleDetailed(
      { job_id: jobId, limit: 50, hints: spec.hints },
      {
        repo: scratch,
        monid: deps.monid,
        env: searchEnv(env, Math.min(SEARCH_CALL_USD, room)),
        enrichers: deps.search?.enrichers ?? recruitEnrichers(),
        ...(deps.search?.sources ? { sources: deps.search.sources } : {}),
      },
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const spend = res?.spend_usd ?? 0;
  const sourceErrors = (res?.runs ?? []).filter((r) => r.error && !r.error.startsWith('skipped')).map((r) => `${r.source}: ${r.error}`);
  const problem = (error ?? sourceErrors.join('; ')).slice(0, 300) || null;
  await repo.log({ kind: 'search', status: error ? 'failed' : 'ok', family: spec.key, cost_usd: spend, reason: problem });

  const found = res?.output.candidates ?? [];
  const people = new Map((await scratch.getPeople(found.map((c) => c.candidate_id))).map((p) => [p.id, p]));
  const recentSince = now.getTime() - RECENT_DAYS * DAY_MS;
  let fresh = 0;
  const candidates: RecruitCandidate[] = [];
  for (const cand of found.slice(0, SAVE_MAX)) {
    const p = people.get(cand.candidate_id);
    if (!p || p.kind !== 'person' || !p.email) continue;
    const stored = await deps.pool.upsertLead(toLead(p), p.dedupe_key);
    if (stored.opted_out || !stored.email) continue;
    const { contact, created } = await repo.upsertContact({
      kind: 'recruit',
      email: stored.email,
      name: stored.name,
      family: spec.key,
      worker_id: stored.id,
      found_via: describeFound({ profiles: stored.profiles.length ? stored.profiles : p.profiles, headline: stored.headline ?? p.headline }),
    });
    if (created) fresh++;
    if (contact.opted_out || !contact.worker_id || (await isOptedOut(deps, contact.email))) continue;
    if (contact.last_contacted_at && contact.last_contacted_at.getTime() > recentSince) continue;
    candidates.push({ person_id: contact.worker_id, name: stored.name, headline: stored.headline, source: cand.source, score: cand.score, distance_km: cand.distance_km });
  }
  return {
    ...head,
    found: found.length,
    new: fresh,
    spend_usd: round(spend),
    spend_today_usd: round(spentBefore + spend),
    ...(problem ? { error: problem } : {}),
    candidates: candidates.slice(0, limit),
  };
}

export interface InviteResult {
  person_id: string;
  status: SendStatus;
  reason?: string;
}

export interface RecruitInviteResult {
  sent: number;
  dry_run: number;
  skipped: number;
  failed: number;
  /** Sends + dry runs today: what counts against the cap. */
  used_today: number;
  daily_cap: number;
  results: InviteResult[];
}

const RECRUIT_SENDER_HINT = 'set GROWTH_RECRUIT_AGENTMAIL_INBOX (or AGENTMAIL_INBOX) and MONID_API_KEY';

async function inviteOne(deps: GrowthDeps, spec: FamilySpec, personId: string): Promise<Outcome> {
  const { env, repo } = deps;
  const c = await repo.getRecruitByWorker(personId);
  if (!c) return { status: 'skipped', reason: 'unknown_person: use person_id values from recruit_search' };
  const decision = await decide(deps, 'invite', c.email);
  if (decision.action === 'skip') return logSkip(deps, c, 'invite', decision.reason, spec.key);
  const now = deps.now();
  const message = renderInvite({
    firstName: firstNameOf(c.name),
    familyLabel: spec.label,
    familySubject: spec.subject,
    joinUrl: joinUrl(env.PUBLIC_BASE_URL, signLink(env.LINK_SIGNING_SECRET, 'join', c.id, now)),
    foundVia: c.found_via,
    postalAddress: env.GROWTH_POSTAL_ADDRESS,
    unsubscribeUrl: unsubscribeUrl(env.PUBLIC_BASE_URL, signLink(env.LINK_SIGNING_SECRET, 'unsubscribe', c.id, now)),
  });
  return deliver(deps, { contact: c, kind: 'invite', family: spec.key, decision, message, sender: deps.senders.recruit, senderHint: RECRUIT_SENDER_HINT });
}

/** Invite people from recruit_search to join the pool (join link + ID check), up to 20 per call. */
export async function recruitInvite(deps: GrowthDeps, input: { family: Family; person_ids: string[] }): Promise<RecruitInviteResult> {
  const spec = FAMILIES[input.family];
  const results: InviteResult[] = [];
  for (const personId of [...new Set(input.person_ids)].slice(0, 20)) results.push({ person_id: personId, ...(await inviteOne(deps, spec, personId)) });
  const today = await deps.repo.messageCountsSince('invite', pacificDayStart(deps.now()));
  const count = (s: SendStatus) => results.filter((r) => r.status === s).length;
  return {
    sent: count('sent'),
    dry_run: count('dry_run'),
    skipped: count('skipped'),
    failed: count('failed'),
    used_today: today.sent + today.dry_run,
    daily_cap: deps.env.GROWTH_RECRUIT_DAILY_CAP,
    results,
  };
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd services/growth && ../../node_modules/.bin/vitest run && ../../node_modules/.bin/tsc --noEmit`
Expected: 7 files pass; tsc exit 0. If the developers fixture scores under Andrew's `MIN_SCORE` (0.3) and `candidates` comes back empty, make the fixture's headline and categories match the family's roles more closely; do not lower any threshold.

- [ ] **Step 5: Commit**

```bash
git add services/growth/src/recruit.ts services/growth/test/recruit.test.ts
git commit -m "growth: Recruiter tools (recruit_search on find_people without ContactOut, recruit_invite)"
```

---
### Task 6: Unsubscribe and join pages

**Files:**
- Create: `services/growth/src/pages.ts`
- Test: `services/growth/test/pages.test.ts`

**Interfaces:**
- Consumes: `verifyLink`, `isOptedOut`, `optOutEverywhere`, `firstNameOf`; `deps.pool.setRegular`, `deps.identity`.
- Produces: `PageResult = { status, html } | { redirect }`, `page(title, body)`, `unsubscribePage(deps, token)`, `joinPage(deps, token)`, `joinAction(deps, token, action)`.

- [ ] **Step 1: Write the failing test**

<!-- file: services/growth/test/pages.test.ts -->
```ts
import { describe, expect, it } from 'vitest';
import { decide } from '../src/guard.js';
import { signLink } from '../src/links.js';
import { joinAction, joinPage, unsubscribePage, type PageResult } from '../src/pages.js';
import { DAY_MS } from '../src/time.js';
import { NOW, SECRET, recruitContact, setup } from './helpers.js';

const html = (r: PageResult) => ('html' in r ? r.html : '');

describe('join link', () => {
  it('GET changes nothing; opt_in makes a regular; identity redirects to Stripe', async () => {
    const s = setup();
    const c = await recruitContact(s, 'ada@devs.example');
    const t = signLink(SECRET, 'join', c.id, NOW);
    const get = await joinPage(s.deps, t);
    expect(get).toMatchObject({ status: 200 });
    expect(html(get)).toContain('Yes, send me jobs');
    expect(s.pool.people.get(c.worker_id!)!.regular).toBe(false);

    const joined = await joinAction(s.deps, t, 'opt_in');
    expect(html(joined)).toContain('Verify my ID');
    expect(s.pool.people.get(c.worker_id!)!.regular).toBe(true);
    expect((await s.repo.getContact(c.id))!.joined_at).toEqual(NOW);

    expect(await joinAction(s.deps, t, 'identity')).toEqual({ redirect: `https://verify.stripe.test/${c.worker_id}` });
    expect(s.identityCalls).toEqual([c.worker_id]);
  });

  it('asks to join before the ID check and refuses tampered or expired links', async () => {
    const s = setup();
    const c = await recruitContact(s, 'ada@devs.example');
    const t = signLink(SECRET, 'join', c.id, NOW);
    expect(await joinAction(s.deps, t, 'identity')).toMatchObject({ status: 409 });
    expect(await joinPage(s.deps, `${t}x`)).toMatchObject({ status: 400 });
    s.advance(31 * DAY_MS);
    expect(await joinAction(s.deps, t, 'opt_in')).toMatchObject({ status: 400 });
    expect(s.pool.people.get(c.worker_id!)!.regular).toBe(false);
  });
});

describe('unsubscribe link', () => {
  it('one click opts out of growth and Ops outreach; later invites and joins are refused', async () => {
    const s = setup();
    const c = await recruitContact(s, 'ada@devs.example');
    const r = await unsubscribePage(s.deps, signLink(SECRET, 'unsubscribe', c.id, NOW));
    expect(r).toMatchObject({ status: 200 });
    expect(html(r)).toContain("You're unsubscribed");
    expect(s.pool.people.get(c.worker_id!)!.opted_out).toBe(true);
    expect(await decide(s.deps, 'invite', 'ada@devs.example')).toEqual({ action: 'skip', reason: 'opted_out' });
    const join = await joinAction(s.deps, signLink(SECRET, 'join', c.id, NOW), 'opt_in');
    expect(html(join)).toContain('You unsubscribed');
    expect(s.pool.people.get(c.worker_id!)!.regular).toBe(false);
  });

  it('still works years later, and a broken link offers a way out', async () => {
    const s = setup();
    const c = await recruitContact(s, 'ada@devs.example');
    const t = signLink(SECRET, 'unsubscribe', c.id, NOW);
    s.advance(3 * 365 * DAY_MS);
    expect(await unsubscribePage(s.deps, t)).toMatchObject({ status: 200 });
    const bad = await unsubscribePage(s.deps, 'u.nope');
    expect(bad).toMatchObject({ status: 400 });
    expect(html(bad)).toContain('ops@operis.live');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd services/growth && ../../node_modules/.bin/vitest run test/pages.test.ts`
Expected: FAIL, cannot find `../src/pages.js`.

- [ ] **Step 3: Implement**

<!-- file: services/growth/src/pages.ts -->
```ts
/**
 * The pages behind the links in growth emails (apps/api/src/app/v1/growth/*). Unsubscribe is one click, no login.
 * The join page changes nothing on GET (email link scanners fetch links too); its buttons POST.
 */
import type { GrowthDeps } from './deps.js';
import { verifyLink } from './links.js';
import { isOptedOut, optOutEverywhere } from './optout.js';
import { firstNameOf } from './templates.js';
import type { Contact } from './types.js';

/** What a route returns: an HTML page, or a redirect (to Stripe Identity). */
export type PageResult = { status: number; html: string } | { redirect: string };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const para = (t: string) => `<p>${esc(t)}</p>`;
const muted = (t: string) => `<p class="muted">${esc(t)}</p>`;
const WAY_OUT = 'Email ops@operis.live and we will take you off our lists by hand.';

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Operis</title><style>body{margin:0;background:#fbfaf6;color:#2f3a33;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}main{max-width:520px;margin:0 auto;padding:48px 20px}.brand{font:700 18px Georgia,"Times New Roman",serif;margin-bottom:28px}h1{font:600 28px/1.2 Georgia,"Times New Roman",serif;margin:0 0 14px}p{margin:0 0 14px}form{margin:22px 0}button{background:#46664f;color:#f4f1e8;border:0;border-radius:999px;padding:13px 28px;font:700 13px/1 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:1.2px;text-transform:uppercase;cursor:pointer}.muted{color:#8a8f8a;font-size:13px}</style></head><body><main><div class="brand">Operis</div><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

const button = (token: string, action: 'opt_in' | 'identity', label: string) =>
  `<form method="post" action="/v1/growth/join"><input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="action" value="${action}"><button type="submit">${esc(label)}</button></form>`;
const identityStep = (token: string) =>
  para('One more step, if you like: verify your ID once with Stripe (about 2 minutes). Larger jobs and jobs that need a license require a verified ID.') +
  button(token, 'identity', 'Verify my ID');
const html = (status: number, title: string, body: string): PageResult => ({ status, html: page(title, body) });
const unsubscribed = () => html(200, 'You unsubscribed', para("You asked us not to contact you, so we won't send you jobs. Changed your mind? Email ops@operis.live."));
const badJoinLink = () => html(400, 'This link has expired', para('Join links last 30 days. Use the link in a newer invitation from us, or email ops@operis.live.'));

/** The recruit a valid, unexpired join token points at, or null. */
async function recruitFor(deps: GrowthDeps, token: string | null): Promise<Contact | null> {
  const id = verifyLink(deps.env.LINK_SIGNING_SECRET, token, 'join', deps.now());
  const c = id ? await deps.repo.getContact(id) : null;
  return c && c.kind === 'recruit' && c.worker_id ? c : null;
}

/** GET or POST /v1/growth/unsubscribe?t=… */
export async function unsubscribePage(deps: GrowthDeps, token: string | null): Promise<PageResult> {
  const id = verifyLink(deps.env.LINK_SIGNING_SECRET, token, 'unsubscribe', deps.now());
  const c = id ? await deps.repo.getContact(id) : null;
  if (!c) return html(400, 'We could not read this link', para(`The unsubscribe link looks incomplete. ${WAY_OUT}`));
  await optOutEverywhere(deps, c.email);
  await deps.repo.log({ contact_id: c.id, kind: 'unsubscribe', status: 'ok' });
  return html(200, "You're unsubscribed", para('We will not email you again, about jobs or anything else.') + muted('Operis · operis.live'));
}

/** GET /v1/growth/join?t=… */
export async function joinPage(deps: GrowthDeps, token: string | null): Promise<PageResult> {
  const c = await recruitFor(deps, token);
  if (!c || !token) return badJoinLink();
  if (c.opted_out || (await isOptedOut(deps, c.email))) return unsubscribed();
  if (c.joined_at) return html(200, "You're in", para('We will email you job offers that fit you.') + identityStep(token));
  const first = firstNameOf(c.name);
  return html(
    200,
    'Get job offers from Operis',
    para(`Hi ${first ?? 'there'}, Operis offers short, paid jobs from AI agents and businesses. Join to get offers by email: no account and no fee, and you take only the jobs you want.`) +
      button(token, 'opt_in', 'Yes, send me jobs') +
      muted('Every email from us has a one-click unsubscribe link.'),
  );
}

/** POST /v1/growth/join with t and action: opt_in makes the person a regular in Andrew's pool; identity starts Stripe Identity. */
export async function joinAction(deps: GrowthDeps, token: string | null, action: string): Promise<PageResult> {
  const c = await recruitFor(deps, token);
  if (!c || !token || !c.worker_id) return badJoinLink();
  if (c.opted_out || (await isOptedOut(deps, c.email))) return unsubscribed();
  if (action === 'opt_in') {
    await deps.pool.setRegular(c.worker_id, true);
    await deps.repo.markJoined(c.id, deps.now());
    await deps.repo.log({ contact_id: c.id, kind: 'join', status: 'ok', family: c.family });
    return html(200, "You're in", para('Thanks. We will email you job offers that fit you; take only the ones you want.') + identityStep(token));
  }
  if (action === 'identity') {
    if (!c.joined_at) return html(409, 'Join first', para('Join first, then verify your ID.') + button(token, 'opt_in', 'Yes, send me jobs'));
    if (!deps.identity) return html(503, 'ID check unavailable', para("We couldn't start the ID check right now. Please try again later."));
    try {
      const r = await deps.identity(c.worker_id);
      await deps.repo.log({ contact_id: c.id, kind: 'identity', status: 'ok', reason: r.status });
      return r.url ? { redirect: r.url } : html(200, 'Your ID is verified', para('Nothing more to do. We will email you job offers that fit you.'));
    } catch (e) {
      await deps.repo.log({ contact_id: c.id, kind: 'identity', status: 'failed', reason: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
      return html(502, 'ID check unavailable', para("We couldn't start the ID check. Please try again later."));
    }
  }
  return html(400, 'Unknown action', para('Please use the buttons on the page.'));
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd services/growth && ../../node_modules/.bin/vitest run && ../../node_modules/.bin/tsc --noEmit`
Expected: 8 files pass; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/growth/src/pages.ts services/growth/test/pages.test.ts
git commit -m "growth: one-click unsubscribe and join pages (opt in, then Stripe Identity)"
```

---

### Task 7: Demand targeting, promo redemption and growth_report

**Files:**
- Create: `services/growth/src/demand.ts`, `services/growth/src/redeem.ts`, `services/growth/src/report.ts`
- Test: `services/growth/test/demand.test.ts`, `services/growth/test/redeem.test.ts`, `services/growth/test/report.test.ts`

**Interfaces:**
- Consumes: `grantKeyFor` (Task 4); `FAMILIES`, `FAMILY_KEYS`, `PIER70`, `RADIUS_KM`; Andrew's `distanceKm(aLat, aLng, bLat, bLng)`.
- Produces: `DemandFamily`, `DEMAND_FAMILIES`, `classifyJob(job)`, `FamilyDemand`, `Demand`, `demandFrom(jobs, now)`, `TARGET_MAX = 60`, `targetFor(family, demand)`; `PROMO_REASON`, `PromoDue`, `RedeemResult`, `promosDue(deps)`, `redeemPromo(deps, jobId)`; `DirectoryEntry`, `GrowthReport`, `growthReport(deps)`.

- [ ] **Step 1: Write the failing tests**

<!-- file: services/growth/test/demand.test.ts -->
```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { classifyJob, demandFrom, targetFor } from '../src/demand.js';
import type { JobRow } from '../src/types.js';
import { NOW } from './helpers.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ZERO = { last_7d: 0, prior_7d: 0, projected_next_7d: 0, unfilled_7d: 0 };
const job = (over: Partial<JobRow>): JobRow => ({
  id: randomUUID(),
  title: 'Photograph the storefront',
  instructions: 'Take 3 photos',
  certification_required: null,
  lat: 37.7609,
  lng: -122.3875,
  remote: false,
  status: 'paid',
  worker_id: 'w1',
  created_at: NOW,
  updated_at: NOW,
  ...over,
});
const remote = { remote: true, lat: null, lng: null };

describe('classifyJob', () => {
  it('sorts jobs into families by what they ask for', () => {
    expect(classifyJob(job({ title: 'Notarize a lease' }))).toBe('sf_notaries');
    expect(classifyJob(job({ title: 'Sign papers', certification_required: 'notary public' }))).toBe('sf_notaries');
    expect(classifyJob(job({ title: 'Review our terms of service', ...remote }))).toBe('ca_attorneys');
    expect(classifyJob(job({ title: 'Fix our Next.js deploy', ...remote }))).toBe('developers');
    expect(classifyJob(job({}))).toBe('pier70_gigs');
    expect(classifyJob(job({ lat: 37.8044, lng: -122.2712 }))).toBe('other'); // Oakland, about 13 km away
    expect(classifyJob(job({ title: 'Translate a menu', ...remote }))).toBe('other');
  });
});

describe('demandFrom', () => {
  it('counts the last and prior week, projects growth and counts unfilled jobs', () => {
    const d = demandFrom(
      [
        job({ title: 'Notarize a lease', created_at: ago(2 * HOUR) }),
        job({ title: 'Notarize a deed', created_at: ago(3 * DAY), status: 'expired', worker_id: null }),
        job({ title: 'Notarize a will', created_at: ago(10 * DAY) }),
        job({ title: 'Hold a sign', created_at: ago(HOUR), status: 'outreach', worker_id: null, updated_at: ago(20 * MIN) }),
        job({ title: 'Hold a  Sign', created_at: ago(20 * DAY) }),
      ],
      NOW,
    );
    expect(d.by_family.sf_notaries).toEqual({ last_7d: 2, prior_7d: 1, projected_next_7d: 3, unfilled_7d: 1 });
    expect(d.by_family.pier70_gigs).toEqual({ last_7d: 1, prior_7d: 0, projected_next_7d: 2, unfilled_7d: 1 });
    expect(d.by_family.developers).toEqual(ZERO);
    expect(d.top_requested[0]).toEqual({ title: 'hold a sign', count: 2 });
  });

  it('holds a decline flat instead of projecting it down', () => {
    const d = demandFrom([job({ created_at: ago(DAY) }), job({ created_at: ago(8 * DAY) }), job({ created_at: ago(9 * DAY) })], NOW);
    expect(d.by_family.pier70_gigs).toMatchObject({ last_7d: 1, prior_7d: 2, projected_next_7d: 1 });
  });
});

describe('targetFor', () => {
  it('is 3 per expected job plus every unfilled job, between the floor and 60', () => {
    expect(targetFor('sf_notaries', { last_7d: 2, prior_7d: 1, projected_next_7d: 3, unfilled_7d: 1 })).toBe(12);
    expect(targetFor('pier70_gigs', ZERO)).toBe(15);
    expect(targetFor('developers', { ...ZERO, projected_next_7d: 40 })).toBe(60);
  });
});
```

<!-- file: services/growth/test/redeem.test.ts -->
```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { grantKeyFor } from '../src/promo.js';
import { PROMO_REASON, promosDue, redeemPromo } from '../src/redeem.js';
import { DAY_MS } from '../src/time.js';
import { NOW, prospect, setup } from './helpers.js';

const HOUR = 3_600_000;

async function world() {
  const s = setup();
  const c = await prospect(s.repo, { email: 'jane@agentco.example' });
  const grant = (await s.repo.insertGrant({ contact_id: c.id, grant_key: 'agentco.example', cap_cents: 2500, expires_at: new Date(NOW.getTime() + 14 * DAY_MS) }))!;
  const customer = { id: randomUUID(), name: 'AgentCo', contact_email: 'Ops@AgentCo.example' };
  s.repo.customers.push(customer);
  const job = (over: { status?: string; budget_usd?: number; created_at?: Date; customer_id?: string | null } = {}) => {
    const at = over.created_at ?? new Date(NOW.getTime() + HOUR);
    const j = {
      id: randomUUID(),
      title: 'Photograph the venue',
      instructions: '3 photos',
      certification_required: null,
      lat: 37.76,
      lng: -122.39,
      remote: false,
      status: 'paid',
      worker_id: randomUUID(),
      updated_at: at,
      customer_id: customer.id,
      budget_usd: 60,
      ...over,
      created_at: at,
    };
    s.repo.jobs.push(j);
    return j;
  };
  return { s, grant, job };
}

describe('grantKeyFor', () => {
  it('uses the company domain, or the full address at free-mail providers', () => {
    expect(grantKeyFor('Jane@AgentCo.example')).toBe('agentco.example');
    expect(grantKeyFor('jane@gmail.com')).toBe('jane@gmail.com');
  });
});

describe('redeem_promo', () => {
  it('returns the exact refund for the first paid job and reserves the grant; a retry gets the same call', async () => {
    const { s, grant, job } = await world();
    const j = job();
    const want = { eligible: true, refund: { job_id: j.id, amount_cents: 2500, request_id: `promo:${grant.id}`, reason: PROMO_REASON } };
    expect(await redeemPromo(s.deps, j.id)).toEqual(want);
    expect(await redeemPromo(s.deps, j.id)).toEqual(want);
    expect(await redeemPromo(s.deps, job({ created_at: new Date(NOW.getTime() + 2 * HOUR) }).id)).toEqual({ eligible: false, reason: 'grant_already_redeemed' });
  });

  it('refunds at most the job price', async () => {
    const { s, job } = await world();
    expect(await redeemPromo(s.deps, job({ budget_usd: 20 }).id)).toMatchObject({ eligible: true, refund: { amount_cents: 2000 } });
  });

  it('refuses unpaid, pre-offer, expired, unknown and unmatched jobs', async () => {
    const { s, job } = await world();
    expect(await redeemPromo(s.deps, job({ status: 'accepted' }).id)).toEqual({ eligible: false, reason: 'job_not_paid: status is accepted' });
    expect(await redeemPromo(s.deps, job({ created_at: new Date(NOW.getTime() + 15 * DAY_MS) }).id)).toEqual({ eligible: false, reason: 'offer_expired' });
    expect(await redeemPromo(s.deps, randomUUID())).toEqual({ eligible: false, reason: 'job_not_found' });
    const other = { id: randomUUID(), name: 'Other', contact_email: 'x@other.example' };
    s.repo.customers.push(other);
    expect(await redeemPromo(s.deps, job({ customer_id: other.id }).id)).toEqual({ eligible: false, reason: 'no_grant_for_customer' });
    expect(await redeemPromo(s.deps, job({ created_at: new Date(NOW.getTime() - HOUR) }).id)).toEqual({ eligible: false, reason: 'job_predates_offer' });
  });

  it('is not a first job when the customer already had a paid one', async () => {
    const { s, job } = await world();
    job({ created_at: new Date(NOW.getTime() + HOUR) });
    const second = job({ created_at: new Date(NOW.getTime() + 2 * HOUR) });
    expect(await redeemPromo(s.deps, second.id)).toEqual({ eligible: false, reason: 'not_first_paid_job' });
  });

  it('lists due promos until they are redeemed', async () => {
    const { s, job } = await world();
    const j = job();
    expect(await promosDue(s.deps)).toEqual([{ job_id: j.id, customer: 'AgentCo', refund_cents: 2500 }]);
    await redeemPromo(s.deps, j.id);
    expect(await promosDue(s.deps)).toEqual([]);
  });
});
```

<!-- file: services/growth/test/report.test.ts -->
```ts
import { describe, expect, it } from 'vitest';
import { growthReport } from '../src/report.js';
import { NOW, prospect, recruitContact, setup } from './helpers.js';

describe('growth_report', () => {
  it('counts the directory per family, with targets from demand and the gaps', async () => {
    const s = setup();
    const a = await recruitContact(s, 'a@devs.example');
    const b = await recruitContact(s, 'b@devs.example');
    await recruitContact(s, 'c@devs.example');
    await s.repo.markContacted(a.id, NOW);
    await s.repo.markJoined(a.id, NOW);
    await s.repo.markJoined(b.id, NOW);
    s.repo.verifications.push({ worker_id: a.worker_id!, kind: 'identity', status: 'verified' }, { worker_id: b.worker_id!, kind: 'identity', status: 'pending' });
    for (let i = 0; i < 4; i++) {
      s.repo.jobs.push({ id: `j${i}`, title: 'Fix our Next.js deploy', instructions: 'remote', certification_required: null, lat: null, lng: null, remote: true, status: 'paid', worker_id: 'w', created_at: NOW, updated_at: NOW, customer_id: null, budget_usd: 60 });
    }
    await prospect(s.repo);
    const r = await growthReport(s.deps);
    expect(r.directory.developers).toEqual({ found: 3, invited: 1, opted_in: 2, id_verified: 1, licensed: 0, target: 24, gap: 23 });
    expect(r.directory.sf_notaries).toEqual({ found: 0, invited: 0, opted_in: 0, id_verified: 0, licensed: 0, target: 5, gap: 5 });
    expect(r.demand.by_family.developers).toEqual({ last_7d: 4, prior_7d: 0, projected_next_7d: 8, unfilled_7d: 0 });
    expect(r.sales).toEqual({ sent_today: 0, dry_run_today: 0, daily_cap: 25, prospects_waiting: 1 });
    expect(r.recruiting).toEqual({ sent_today: 0, dry_run_today: 0, daily_cap: 40, search_spend_today_usd: 0, search_cap_usd: 2 });
    expect(r.live).toEqual({ sales: false, recruit: false });
    expect(r.promos).toEqual({ granted: 0, max: 20, redeemed: 0, due: [] });
    expect(r.day).toBe('2026-11-08');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd services/growth && ../../node_modules/.bin/vitest run test/demand.test.ts test/redeem.test.ts test/report.test.ts`
Expected: FAIL, cannot find `../src/demand.js`, `../src/redeem.js`, `../src/report.js`.

- [ ] **Step 3: Implement**

<!-- file: services/growth/src/demand.ts -->
```ts
/**
 * Demand by job family (spec section 9): what customers asked for in the last 7 days against the 7 before, a
 * projection for the next 7, the jobs we failed to fill, and the pre-vetted target that follows from them.
 */
import { distanceKm } from '../../outreach/src/geo.js';
import { FAMILIES, FAMILY_KEYS, PIER70, RADIUS_KM, type Family } from './families.js';
import { DAY_MS } from './time.js';
import type { JobRow } from './types.js';

export type DemandFamily = Family | 'other';
export const DEMAND_FAMILIES: DemandFamily[] = [...FAMILY_KEYS, 'other'];

const NOTARY = /\bnotar(y|ies|ize|ized|izing|ization)\b/;
const LEGAL = /\b(attorney|lawyer|legal|contract review|terms of service|privacy policy)\b/;
const DEV = /\b(developer|code|coding|bug|deploy|react|next\.?js|typescript|frontend|backend)\b/;

export function classifyJob(j: Pick<JobRow, 'title' | 'instructions' | 'certification_required' | 'lat' | 'lng' | 'remote'>): DemandFamily {
  const text = `${j.title} ${j.instructions} ${j.certification_required ?? ''}`.toLowerCase();
  if (NOTARY.test(text)) return 'sf_notaries';
  if (LEGAL.test(text)) return 'ca_attorneys';
  if (DEV.test(text)) return 'developers';
  if (!j.remote && j.lat !== null && j.lng !== null && distanceKm(j.lat, j.lng, PIER70.lat, PIER70.lng) <= RADIUS_KM) return 'pier70_gigs';
  return 'other';
}

export interface FamilyDemand {
  last_7d: number;
  prior_7d: number;
  projected_next_7d: number;
  unfilled_7d: number;
}

export interface Demand {
  by_family: Record<DemandFamily, FamilyDemand>;
  /** The most requested job titles of the last 30 days, lowercased. Internal: never quoted to prospects. */
  top_requested: { title: string; count: number }[];
}

const STUCK_MS = 15 * 60_000;

/** `jobs` should cover the last 30 days (top_requested); the weekly counts use the last 14. */
export function demandFrom(jobs: JobRow[], now: Date): Demand {
  const t = now.getTime();
  const by = Object.fromEntries(DEMAND_FAMILIES.map((f) => [f, { last_7d: 0, prior_7d: 0, projected_next_7d: 0, unfilled_7d: 0 }])) as Record<DemandFamily, FamilyDemand>;
  const titles = new Map<string, number>();
  for (const j of jobs) {
    const age = t - j.created_at.getTime();
    if (age < 0) continue;
    if (age <= 30 * DAY_MS) {
      const key = j.title.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
      if (key) titles.set(key, (titles.get(key) ?? 0) + 1);
    }
    const d = by[classifyJob(j)];
    if (age <= 7 * DAY_MS) {
      d.last_7d++;
      const stuck = j.status === 'outreach' && t - j.updated_at.getTime() >= STUCK_MS;
      if (!j.worker_id && (j.status === 'expired' || j.status === 'cancelled' || stuck)) d.unfilled_7d++;
    } else if (age <= 14 * DAY_MS) {
      d.prior_7d++;
    }
  }
  for (const d of Object.values(by)) d.projected_next_7d = d.last_7d + Math.max(0, d.last_7d - d.prior_7d);
  const top_requested = [...titles]
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, 5);
  return { by_family: by, top_requested };
}

export const TARGET_MAX = 60;

/** Three pre-vetted people per expected job plus every job we failed to fill, never below the family's floor. */
export function targetFor(family: Family, d: FamilyDemand): number {
  return Math.max(FAMILIES[family].floor, Math.min(TARGET_MAX, 3 * (d.projected_next_7d + d.unfilled_7d)));
}
```

<!-- file: services/growth/src/redeem.ts -->
```ts
/**
 * Redeeming a free first job (spec section 11). The CEO calls redeem_promo for a paid job; it checks the grant,
 * reserves it, and returns the exact operis.refund call to make. Money code is not touched: the refund itself is
 * Cameron's existing tool.
 */
import type { GrowthDeps } from './deps.js';
import { grantKeyFor } from './promo.js';
import type { Grant, JobWithCustomer } from './types.js';

export const PROMO_REASON = 'Free first job (Operis Sales offer)';
const cents = (usd: number) => Math.round(usd * 100);

export interface PromoDue {
  job_id: string;
  customer: string;
  refund_cents: number;
}

export type RedeemResult =
  | { eligible: true; refund: { job_id: string; amount_cents: number; request_id: string; reason: string } }
  | { eligible: false; reason: string };

/** Null when grant `g` covers paid job `j`; otherwise why not. */
async function whyNot(deps: GrowthDeps, g: Grant, j: JobWithCustomer): Promise<string | null> {
  if (g.redeemed_job_id && g.redeemed_job_id !== j.job_id) return 'grant_already_redeemed';
  if (j.created_at < g.created_at) return 'job_predates_offer';
  if (j.created_at > g.expires_at) return 'offer_expired';
  if (!j.customer_id) return 'job_has_no_customer';
  if ((await deps.repo.countPaidJobsBefore(j.customer_id, j.created_at, j.job_id)) > 0) return 'not_first_paid_job';
  return null;
}

/** Paid jobs an unredeemed grant covers: the CEO's to-do list in the daily report. */
export async function promosDue(deps: GrowthDeps): Promise<PromoDue[]> {
  const open = new Map((await deps.repo.listGrants()).filter((g) => !g.redeemed_job_id).map((g) => [g.grant_key, g]));
  if (open.size === 0) return [];
  const due: PromoDue[] = [];
  for (const j of await deps.repo.listPaidJobs()) {
    const g = j.contact_email ? open.get(grantKeyFor(j.contact_email)) : undefined;
    if (!g || (await whyNot(deps, g, j))) continue;
    due.push({ job_id: j.job_id, customer: j.customer_name ?? j.contact_email ?? 'unknown', refund_cents: Math.min(g.cap_cents, cents(j.budget_usd)) });
  }
  return due;
}

const instruction = (g: Grant, jobId: string): RedeemResult => ({
  eligible: true,
  refund: { job_id: jobId, amount_cents: g.refund_cents ?? 0, request_id: `promo:${g.id}`, reason: PROMO_REASON },
});

export async function redeemPromo(deps: GrowthDeps, jobId: string): Promise<RedeemResult> {
  const reserved = await deps.repo.getGrantByJob(jobId);
  if (reserved) return instruction(reserved, jobId); // a retry gets the same call; refund's request_id makes it idempotent
  const j = await deps.repo.getJobWithCustomer(jobId);
  if (!j) return { eligible: false, reason: 'job_not_found' };
  if (j.status !== 'paid') return { eligible: false, reason: `job_not_paid: status is ${j.status}` };
  if (!j.contact_email) return { eligible: false, reason: 'customer_has_no_contact_email' };
  const g = await deps.repo.getGrantByKey(grantKeyFor(j.contact_email));
  if (!g) return { eligible: false, reason: 'no_grant_for_customer' };
  const why = await whyNot(deps, g, j);
  if (why) return { eligible: false, reason: why };
  const refundCents = Math.min(g.cap_cents, cents(j.budget_usd));
  if (refundCents <= 0) return { eligible: false, reason: 'nothing_to_refund' };
  const after = await deps.repo.reserveGrant(g.id, jobId, refundCents, deps.now());
  if (!after || after.redeemed_job_id !== jobId) return { eligible: false, reason: 'grant_already_redeemed' };
  return instruction(after, jobId);
}
```

<!-- file: services/growth/src/report.ts -->
```ts
/** growth_report: one read for Sales, Recruiter and the CEO (spec section 8). */
import type { GrowthDeps } from './deps.js';
import { demandFrom, targetFor, type Demand } from './demand.js';
import { FAMILY_KEYS, type Family } from './families.js';
import { RECENT_DAYS } from './guard.js';
import { promosDue, type PromoDue } from './redeem.js';
import { DAY_MS, pacificDate, pacificDayStart } from './time.js';

export interface DirectoryEntry {
  found: number;
  invited: number;
  opted_in: number;
  /** Opted in and Stripe Identity verified: pre-vetted. */
  id_verified: number;
  /** Holds a verified licence (notary commission; State Bar after the liability PR). */
  licensed: number;
  target: number;
  gap: number;
}

export interface GrowthReport {
  day: string;
  live: { sales: boolean; recruit: boolean };
  sales: { sent_today: number; dry_run_today: number; daily_cap: number; prospects_waiting: number };
  recruiting: { sent_today: number; dry_run_today: number; daily_cap: number; search_spend_today_usd: number; search_cap_usd: number };
  directory: Record<Family, DirectoryEntry>;
  demand: Demand;
  promos: { granted: number; max: number; redeemed: number; due: PromoDue[] };
}

const LICENCES = new Set(['notary_commission', 'attorney_license']);
const round = (n: number) => Math.round(n * 10_000) / 10_000;

export async function growthReport(deps: GrowthDeps): Promise<GrowthReport> {
  const { env, repo } = deps;
  const now = deps.now();
  const day = pacificDayStart(now);
  const [marketing, invites, spend, waiting, recruits, jobs, grants] = await Promise.all([
    repo.messageCountsSince('marketing', day),
    repo.messageCountsSince('invite', day),
    repo.searchSpendSince(day),
    repo.listProspects({ limit: 1000, notSentSince: new Date(now.getTime() - RECENT_DAYS * DAY_MS) }),
    repo.listRecruits(),
    repo.listJobsSince(new Date(now.getTime() - 30 * DAY_MS)),
    repo.listGrants(),
  ]);
  const verifications = await repo.listVerifications(recruits.map((r) => r.worker_id).filter((id): id is string => Boolean(id)));
  const verified = (keep: (kind: string) => boolean) => new Set(verifications.filter((v) => v.status === 'verified' && keep(v.kind)).map((v) => v.worker_id));
  const idOk = verified((k) => k === 'identity');
  const licensed = verified((k) => LICENCES.has(k));
  const demand = demandFrom(jobs, now);

  const directory = Object.fromEntries(
    FAMILY_KEYS.map((f) => {
      const rs = recruits.filter((r) => r.family === f && !r.opted_out);
      const optedIn = rs.filter((r) => r.joined_at);
      const idVerified = optedIn.filter((r) => r.worker_id && idOk.has(r.worker_id)).length;
      const target = targetFor(f, demand.by_family[f]);
      const entry: DirectoryEntry = {
        found: rs.length,
        invited: rs.filter((r) => r.last_contacted_at).length,
        opted_in: optedIn.length,
        id_verified: idVerified,
        licensed: rs.filter((r) => r.worker_id && licensed.has(r.worker_id)).length,
        target,
        gap: Math.max(0, target - idVerified),
      };
      return [f, entry];
    }),
  ) as Record<Family, DirectoryEntry>;

  return {
    day: pacificDate(now),
    live: {
      sales: env.GROWTH_LIVE.includes('sales') && env.GROWTH_POSTAL_ADDRESS !== null,
      recruit: env.GROWTH_LIVE.includes('recruit') && env.GROWTH_POSTAL_ADDRESS !== null,
    },
    sales: { sent_today: marketing.sent, dry_run_today: marketing.dry_run, daily_cap: env.GROWTH_SALES_DAILY_CAP, prospects_waiting: waiting.length },
    recruiting: {
      sent_today: invites.sent,
      dry_run_today: invites.dry_run,
      daily_cap: env.GROWTH_RECRUIT_DAILY_CAP,
      search_spend_today_usd: round(spend),
      search_cap_usd: env.GROWTH_SEARCH_DAILY_USD,
    },
    directory,
    demand,
    promos: { granted: grants.length, max: env.GROWTH_PROMO_MAX_GRANTS, redeemed: grants.filter((g) => g.redeemed_job_id).length, due: await promosDue(deps) },
  };
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd services/growth && ../../node_modules/.bin/vitest run && ../../node_modules/.bin/tsc --noEmit`
Expected: 11 files pass; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/growth/src/demand.ts services/growth/src/redeem.ts services/growth/src/report.ts services/growth/test/demand.test.ts services/growth/test/redeem.test.ts services/growth/test/report.test.ts
git commit -m "growth: demand-driven targets, free-first-job redemption and growth_report"
```

---

### Task 8: Postgres repository and the migration

**Files:**
- Create: `services/growth/migrations/0001_growth.sql`, `services/growth/src/repo/postgres.ts`
- Check (scratchpad only, not committed): `<scratchpad>/pg-check/check.ts` against PGlite

**Interfaces:**
- Consumes: `GrowthRepo`, `GrowthTablesMissing`, the Task 2 types.
- Produces: `Db { query(text, params?) → { rows } }`, `dbFromPostgresJs(sql)`, `PostgresGrowthRepo(db)`.

- [ ] **Step 1: The migration**

<!-- file: services/growth/migrations/0001_growth.sql -->
```sql
-- Growth tables for the Sales and Recruiter agents (services/growth; docs/specs/2026-11-08-sales-recruiter-design.md).
-- Runs after contracts/schema.sql and services/outreach/migrations. Idempotent. Owner: Cameron.
-- Changes no shared table: reads jobs, customers and worker_verifications; references workers and jobs.

create table if not exists growth_contacts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('prospect', 'recruit')),   -- prospect: hand-sourced (Sales); recruit: recruit_search
  email text not null check (email = lower(email)),
  name text,
  org text,
  family text check (family in ('pier70_gigs', 'sf_notaries', 'ca_attorneys', 'developers')),
  worker_id uuid references workers(id) on delete set null,     -- recruits: the person in the talent pool
  found_via text not null,                                      -- quoted in every email: "How we found you: ..."
  notes text,
  free_first_job boolean not null default false,
  opted_out boolean not null default false,                     -- never cleared
  opted_out_at timestamptz,
  joined_at timestamptz,                                        -- clicked "Yes, send me jobs"
  last_contacted_at timestamptz,                                -- last real send
  created_at timestamptz not null default now(),
  unique (kind, email)
);
create index if not exists growth_contacts_email_idx on growth_contacts (email);
create index if not exists growth_contacts_worker_idx on growth_contacts (worker_id);

create table if not exists growth_log (                         -- caps, budgets and the audit trail are sums over this
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references growth_contacts(id) on delete set null,
  kind text not null check (kind in ('marketing', 'invite', 'search', 'unsubscribe', 'join', 'identity', 'suppress')),
  status text not null check (status in ('sent', 'dry_run', 'skipped', 'failed', 'ok')),
  reason text,
  family text,
  cost_usd numeric not null default 0,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists growth_log_kind_created_idx on growth_log (kind, created_at);

create table if not exists growth_promos (                      -- free-first-job grants, one per team
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references growth_contacts(id),
  grant_key text not null unique,                               -- company domain, or the full address at free-mail providers
  cap_cents integer not null check (cap_cents > 0),
  expires_at timestamptz not null,
  redeemed_job_id uuid unique references jobs(id),
  refund_cents integer,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 2: The repository**

<!-- file: services/growth/src/repo/postgres.ts -->
```ts
import { GrowthTablesMissing, type GrowthRepo } from '../repo.js';
import type { Contact, ContactKind, Grant, JobRow, JobWithCustomer, LogEntry, MessageKind, NewContact, VerificationRow } from '../types.js';

/** Anything with query(text, params) → { rows }: PGlite, @neondatabase/serverless, or postgres.js through dbFromPostgresJs. */
export interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/** apps/api's postgres.js `sql` as a Db (its unsafe(text, params) takes $1-style parameters). */
export function dbFromPostgresJs(sql: { unsafe(text: string, params?: any[]): PromiseLike<unknown> }): Db {
  return { query: async (text, params) => ({ rows: Array.from((await sql.unsafe(text, (params ?? []) as any[])) as Iterable<any>) }) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));
const missingTable = (e: unknown) => (e as { code?: string } | null)?.code === '42P01';
const lower = (email: string) => email.trim().toLowerCase();

function contact(r: any): Contact {
  return {
    id: String(r.id),
    kind: r.kind,
    email: r.email,
    name: r.name ?? null,
    org: r.org ?? null,
    family: r.family ?? null,
    worker_id: r.worker_id ?? null,
    found_via: r.found_via,
    notes: r.notes ?? null,
    free_first_job: Boolean(r.free_first_job),
    opted_out: Boolean(r.opted_out),
    joined_at: date(r.joined_at),
    last_contacted_at: date(r.last_contacted_at),
    created_at: date(r.created_at)!,
  };
}

function grant(r: any): Grant {
  return {
    id: String(r.id),
    contact_id: String(r.contact_id),
    grant_key: r.grant_key,
    cap_cents: Number(r.cap_cents),
    expires_at: date(r.expires_at)!,
    redeemed_job_id: r.redeemed_job_id ?? null,
    refund_cents: r.refund_cents === null || r.refund_cents === undefined ? null : Number(r.refund_cents),
    redeemed_at: date(r.redeemed_at),
    created_at: date(r.created_at)!,
  };
}

function withCustomer(r: any): JobWithCustomer {
  return {
    job_id: String(r.job_id),
    customer_id: r.customer_id ?? null,
    customer_name: r.customer_name ?? null,
    contact_email: r.contact_email ?? null,
    budget_usd: Number(r.budget_usd),
    status: r.status,
    created_at: date(r.created_at)!,
  };
}

const JOB_WITH_CUSTOMER = `select j.id as job_id, j.customer_id, c.name as customer_name, lower(c.contact_email) as contact_email,
  j.budget_usd::float8 as budget_usd, j.status, j.created_at from jobs j left join customers c on c.id = j.customer_id`;

/** GrowthRepo on Postgres (Neon in production): plain SQL with $n parameters over migrations/0001_growth.sql. */
export class PostgresGrowthRepo implements GrowthRepo {
  constructor(private readonly db: Db) {}

  private async q(text: string, params: unknown[] = []): Promise<any[]> {
    try {
      return (await this.db.query(text, params)).rows;
    } catch (e) {
      if (missingTable(e) && /growth_/.test(String((e as Error).message))) throw new GrowthTablesMissing();
      throw e;
    }
  }

  async upsertContact(c: NewContact): Promise<{ contact: Contact; created: boolean }> {
    const rows = await this.q(
      `insert into growth_contacts (kind, email, name, org, family, worker_id, found_via, notes, free_first_job, opted_out, opted_out_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               exists (select 1 from growth_contacts s where s.email = $2 and s.opted_out),
               (select min(s.opted_out_at) from growth_contacts s where s.email = $2 and s.opted_out))
       on conflict (kind, email) do update set
         name = coalesce(growth_contacts.name, excluded.name),
         org = coalesce(growth_contacts.org, excluded.org),
         family = coalesce(growth_contacts.family, excluded.family),
         worker_id = coalesce(growth_contacts.worker_id, excluded.worker_id),
         notes = coalesce(excluded.notes, growth_contacts.notes),
         free_first_job = growth_contacts.free_first_job or excluded.free_first_job
       returning *, (xmax = 0) as created`,
      [c.kind, lower(c.email), c.name ?? null, c.org ?? null, c.family ?? null, c.worker_id ?? null, c.found_via, c.notes ?? null, Boolean(c.free_first_job)],
    );
    return { contact: contact(rows[0]), created: Boolean(rows[0].created) };
  }

  async getContact(id: string): Promise<Contact | null> {
    if (!UUID.test(id)) return null;
    const rows = await this.q('select * from growth_contacts where id = $1', [id]);
    return rows[0] ? contact(rows[0]) : null;
  }

  async getRecruitByWorker(workerId: string): Promise<Contact | null> {
    if (!UUID.test(workerId)) return null;
    const rows = await this.q(`select * from growth_contacts where kind = 'recruit' and worker_id = $1 order by created_at limit 1`, [workerId]);
    return rows[0] ? contact(rows[0]) : null;
  }

  async listProspects(q: { limit: number; notSentSince: Date }): Promise<Contact[]> {
    const rows = await this.q(
      `select * from growth_contacts where kind = 'prospect' and not opted_out
         and (last_contacted_at is null or last_contacted_at < $2) order by created_at, id limit $1`,
      [q.limit, q.notSentSince],
    );
    return rows.map(contact);
  }

  async listRecruits(): Promise<Contact[]> {
    return (await this.q(`select * from growth_contacts where kind = 'recruit' order by created_at`)).map(contact);
  }

  async markContacted(id: string, at: Date): Promise<void> {
    await this.q('update growth_contacts set last_contacted_at = $2 where id = $1', [id, at]);
  }

  async markJoined(id: string, at: Date): Promise<void> {
    await this.q('update growth_contacts set joined_at = coalesce(joined_at, $2) where id = $1', [id, at]);
  }

  async optOutEmail(email: string, at: Date): Promise<number> {
    const e = lower(email);
    const rows = await this.q('update growth_contacts set opted_out = true, opted_out_at = coalesce(opted_out_at, $2) where email = $1 returning id', [e, at]);
    if (rows.length === 0) {
      await this.q(
        `insert into growth_contacts (kind, email, found_via, opted_out, opted_out_at) values ('prospect', $1, 'suppressed: asked us to stop', true, $2)
         on conflict (kind, email) do update set opted_out = true, opted_out_at = coalesce(growth_contacts.opted_out_at, excluded.opted_out_at)`,
        [e, at],
      );
    }
    return rows.length;
  }

  async isSuppressed(email: string): Promise<boolean> {
    return (await this.q('select 1 from growth_contacts where email = $1 and opted_out limit 1', [lower(email)])).length > 0;
  }

  async lastSentAt(email: string, kind: ContactKind): Promise<Date | null> {
    const rows = await this.q('select max(last_contacted_at) as at from growth_contacts where email = $1 and kind = $2', [lower(email), kind]);
    return date(rows[0]?.at);
  }

  async log(e: LogEntry): Promise<void> {
    await this.q('insert into growth_log (contact_id, kind, status, reason, family, cost_usd, ref) values ($1, $2, $3, $4, $5, $6, $7)', [
      e.contact_id ?? null,
      e.kind,
      e.status,
      e.reason ?? null,
      e.family ?? null,
      e.cost_usd ?? 0,
      e.ref ?? null,
    ]);
  }

  async messageCountsSince(kind: MessageKind, since: Date): Promise<{ sent: number; dry_run: number }> {
    const rows = await this.q(
      `select status, count(*)::int as n from growth_log where kind = $1 and created_at >= $2 and status in ('sent', 'dry_run') group by status`,
      [kind, since],
    );
    const n = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
    return { sent: n('sent'), dry_run: n('dry_run') };
  }

  async searchSpendSince(since: Date): Promise<number> {
    const rows = await this.q(`select coalesce(sum(cost_usd), 0)::float8 as usd from growth_log where kind = 'search' and created_at >= $1`, [since]);
    return Number(rows[0]?.usd ?? 0);
  }

  async getGrantByKey(key: string): Promise<Grant | null> {
    const rows = await this.q('select * from growth_promos where grant_key = $1', [key]);
    return rows[0] ? grant(rows[0]) : null;
  }

  async getGrantByJob(jobId: string): Promise<Grant | null> {
    if (!UUID.test(jobId)) return null;
    const rows = await this.q('select * from growth_promos where redeemed_job_id = $1', [jobId]);
    return rows[0] ? grant(rows[0]) : null;
  }

  async countGrants(): Promise<number> {
    return Number((await this.q('select count(*)::int as n from growth_promos'))[0]?.n ?? 0);
  }

  async listGrants(): Promise<Grant[]> {
    return (await this.q('select * from growth_promos order by created_at')).map(grant);
  }

  async insertGrant(g: { contact_id: string; grant_key: string; cap_cents: number; expires_at: Date }): Promise<Grant | null> {
    const rows = await this.q(
      'insert into growth_promos (contact_id, grant_key, cap_cents, expires_at) values ($1, $2, $3, $4) on conflict (grant_key) do nothing returning *',
      [g.contact_id, g.grant_key, g.cap_cents, g.expires_at],
    );
    return rows[0] ? grant(rows[0]) : null;
  }

  async reserveGrant(grantId: string, jobId: string, refundCents: number, at: Date): Promise<Grant | null> {
    const rows = await this.q(
      'update growth_promos set redeemed_job_id = $2, refund_cents = $3, redeemed_at = $4 where id = $1 and redeemed_job_id is null returning *',
      [grantId, jobId, refundCents, at],
    );
    if (rows[0]) return grant(rows[0]);
    const current = await this.q('select * from growth_promos where id = $1', [grantId]);
    return current[0] ? grant(current[0]) : null;
  }

  async listJobsSince(since: Date): Promise<JobRow[]> {
    // jobs.remote comes from services/outreach's 0002 migration; to_jsonb keeps this working without the column.
    const rows = await this.q(
      `select id, title, instructions, certification_required, lat, lng,
              coalesce((to_jsonb(j) ->> 'remote')::boolean, false) as remote, status, worker_id, created_at, updated_at
       from jobs j where created_at >= $1`,
      [since],
    );
    return rows.map((r) => ({
      id: String(r.id),
      title: r.title,
      instructions: r.instructions,
      certification_required: r.certification_required ?? null,
      lat: r.lat === null ? null : Number(r.lat),
      lng: r.lng === null ? null : Number(r.lng),
      remote: Boolean(r.remote),
      status: r.status,
      worker_id: r.worker_id ?? null,
      created_at: date(r.created_at)!,
      updated_at: date(r.updated_at) ?? date(r.created_at)!,
    }));
  }

  async listPaidJobs(): Promise<JobWithCustomer[]> {
    return (await this.q(`${JOB_WITH_CUSTOMER} where j.status = 'paid'`)).map(withCustomer);
  }

  async getJobWithCustomer(jobId: string): Promise<JobWithCustomer | null> {
    if (!UUID.test(jobId)) return null;
    const rows = await this.q(`${JOB_WITH_CUSTOMER} where j.id = $1`, [jobId]);
    return rows[0] ? withCustomer(rows[0]) : null;
  }

  async countPaidJobsBefore(customerId: string, before: Date, excludeJobId: string): Promise<number> {
    const rows = await this.q(`select count(*)::int as n from jobs where customer_id = $1 and status = 'paid' and created_at < $2 and id <> $3`, [
      customerId,
      before,
      excludeJobId,
    ]);
    return Number(rows[0]?.n ?? 0);
  }

  async listVerifications(workerIds: string[]): Promise<VerificationRow[]> {
    const ids = [...new Set(workerIds)].filter((id) => UUID.test(id));
    if (ids.length === 0) return [];
    try {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await this.db.query(`select worker_id, kind, status from worker_verifications where worker_id in (${placeholders})`, ids);
      return rows.map((r) => ({ worker_id: String(r.worker_id), kind: r.kind, status: r.status }));
    } catch (e) {
      if (missingTable(e)) return []; // Cameron's migration has not run yet
      throw e;
    }
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `cd services/growth && ../../node_modules/.bin/tsc --noEmit && ../../node_modules/.bin/vitest run`
Expected: tsc exit 0; 11 files still pass.

- [ ] **Step 4: Check the SQL against PGlite (scratchpad, not committed)**

Install PGlite in the scratchpad only: `mkdir -p <scratchpad>/pg-check && cd <scratchpad>/pg-check && npm init -y >/dev/null && npm install --no-audit --no-fund @electric-sql/pglite@0.3.16 tsx`. Write `check.ts` there:

```ts
// PGlite check of services/growth's migration and PostgresGrowthRepo. Not committed.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ROOT = process.argv[2]!;
const { PostgresGrowthRepo, GrowthTablesMissing } = await import(`${ROOT}/services/growth/src/index.ts`);
const read = (p: string) => readFileSync(`${ROOT}/${p}`, 'utf8');
const BASE = ['contracts/schema.sql', 'services/outreach/migrations/0001_outreach.sql', 'services/outreach/migrations/0002_people.sql', 'services/outreach/migrations/0003_pool.sql', 'services/money-verification/migrations/0001_money_verification.sql'];
let passed = 0;
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`); };

const db = new PGlite();
for (const f of BASE) await db.exec(read(f));
await db.exec(read('services/growth/migrations/0001_growth.sql'));
await db.exec(read('services/growth/migrations/0001_growth.sql'));
ok('migration applies twice (idempotent)');
const repo = new PostgresGrowthRepo({ query: (t: string, p?: unknown[]) => db.query(t, p as any[]) });
const now = new Date('2026-11-08T18:00:00Z');

const a = await repo.upsertContact({ kind: 'prospect', email: 'Jane@AgentCo.example', name: 'Jane', found_via: 'the list', free_first_job: true });
assert.equal(a.created, true); assert.equal(a.contact.email, 'jane@agentco.example');
const b = await repo.upsertContact({ kind: 'prospect', email: 'jane@agentco.example', org: 'AgentCo', found_via: 'other' });
assert.equal(b.created, false); assert.equal(b.contact.org, 'AgentCo'); assert.equal(b.contact.found_via, 'the list'); assert.equal(b.contact.free_first_job, true);
ok('upsertContact inserts, then merges without overwriting');

assert.equal((await repo.listProspects({ limit: 10, notSentSince: now })).length, 1);
await repo.markContacted(a.contact.id, now);
assert.equal((await repo.listProspects({ limit: 10, notSentSince: now })).length, 0);
assert.equal((await repo.lastSentAt('JANE@agentco.example', 'prospect'))?.toISOString(), now.toISOString());
assert.equal(await repo.lastSentAt('jane@agentco.example', 'recruit'), null);
ok('listProspects, markContacted, lastSentAt');

assert.equal(await repo.optOutEmail('jane@agentco.example', now), 1);
assert.equal(await repo.isSuppressed('jane@agentco.example'), true);
assert.equal(await repo.optOutEmail('nobody@x.example', now), 0);
assert.equal(await repo.isSuppressed('nobody@x.example'), true);
const late = await repo.upsertContact({ kind: 'recruit', email: 'nobody@x.example', found_via: 'search' });
assert.equal(late.contact.opted_out, true);
ok('optOutEmail (existing and suppression row); a new row for a suppressed address starts opted out');

await repo.log({ kind: 'marketing', status: 'sent', contact_id: a.contact.id });
await repo.log({ kind: 'marketing', status: 'dry_run' });
await repo.log({ kind: 'marketing', status: 'skipped', reason: 'daily_cap' });
await repo.log({ kind: 'search', status: 'ok', cost_usd: 0.25, family: 'developers' });
await repo.log({ kind: 'search', status: 'ok', cost_usd: 0.1 });
assert.deepEqual(await repo.messageCountsSince('marketing', new Date(0)), { sent: 1, dry_run: 1 });
assert.equal(await repo.searchSpendSince(new Date(0)), 0.35);
ok('log, messageCountsSince, searchSpendSince');

await db.exec(`insert into customers (id, name, contact_email) values ('11111111-1111-4111-8111-111111111111', 'AgentCo', 'Ops@AgentCo.example')`);
await db.exec(`insert into jobs (id, customer_id, title, instructions, lat, lng, budget_usd, proof_requirement, status, created_at)
  values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Notarize a lease', 'x', 37.76, -122.39, 60, '{}', 'paid', now()),
         ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Fix our Next.js deploy', 'x', null, null, 40, '{}', 'outreach', now())`);
await db.exec(`update jobs set remote = true where id = '33333333-3333-4333-8333-333333333333'`);
const jobs = await repo.listJobsSince(new Date(0));
assert.equal(jobs.length, 2); assert.equal(jobs.find((j: any) => j.title.startsWith('Fix'))!.remote, true);
const paid = await repo.listPaidJobs();
assert.deepEqual(paid.map((j: any) => [j.contact_email, j.budget_usd, j.status]), [['ops@agentco.example', 60, 'paid']]);
assert.equal((await repo.getJobWithCustomer('33333333-3333-4333-8333-333333333333'))!.status, 'outreach');
assert.equal(await repo.getJobWithCustomer('not-a-uuid'), null);
assert.equal(await repo.countPaidJobsBefore('11111111-1111-4111-8111-111111111111', new Date(Date.now() + 60_000), '00000000-0000-4000-8000-000000000000'), 1);
ok('listJobsSince (remote via to_jsonb), listPaidJobs, getJobWithCustomer, countPaidJobsBefore');

const g = await repo.insertGrant({ contact_id: a.contact.id, grant_key: 'agentco.example', cap_cents: 2500, expires_at: now });
assert.ok(g); assert.equal(await repo.insertGrant({ contact_id: a.contact.id, grant_key: 'agentco.example', cap_cents: 2500, expires_at: now }), null);
assert.equal(await repo.countGrants(), 1);
const r1 = await repo.reserveGrant(g.id, '22222222-2222-4222-8222-222222222222', 2500, now);
assert.equal(r1.redeemed_job_id, '22222222-2222-4222-8222-222222222222');
const r2 = await repo.reserveGrant(g.id, '33333333-3333-4333-8333-333333333333', 100, now);
assert.equal(r2.redeemed_job_id, '22222222-2222-4222-8222-222222222222'); assert.equal(r2.refund_cents, 2500);
assert.equal((await repo.getGrantByJob('22222222-2222-4222-8222-222222222222'))!.id, g.id);
ok('insertGrant (unique key), reserveGrant (first wins), getGrantByJob');

const w = await db.query(`insert into workers (name, email) values ('Ada', 'ada@devs.example') returning id`);
const wid = (w.rows[0] as any).id;
await db.query(`insert into worker_verifications (worker_id, kind, status) values ($1, 'identity', 'verified')`, [wid]);
assert.deepEqual(await repo.listVerifications([wid, 'junk']), [{ worker_id: wid, kind: 'identity', status: 'verified' }]);
const rc = await repo.upsertContact({ kind: 'recruit', email: 'ada@devs.example', worker_id: wid, family: 'developers', found_via: 'GitHub' });
assert.equal((await repo.getRecruitByWorker(wid))!.id, rc.contact.id);
await repo.markJoined(rc.contact.id, now);
assert.equal((await repo.listRecruits()).find((c: any) => c.id === rc.contact.id)!.joined_at!.toISOString(), now.toISOString());
ok('listVerifications, getRecruitByWorker, markJoined, listRecruits');

const bare = new PGlite();
await bare.exec(read('contracts/schema.sql'));
const bareRepo = new PostgresGrowthRepo({ query: (t: string, p?: unknown[]) => bare.query(t, p as any[]) });
await assert.rejects(() => bareRepo.isSuppressed('x@y.example'), (e: unknown) => e instanceof GrowthTablesMissing);
assert.deepEqual(await bareRepo.listVerifications([wid]), []);
ok('missing growth tables → GrowthTablesMissing; missing worker_verifications → []');
console.log(`PGlite check: ${passed} groups passed`);
```

Run: `cd <scratchpad>/pg-check && npx tsx check.ts <worktree root>`
Expected: 9 `ok` lines and `PGlite check: 9 groups passed`. If PGlite cannot be installed or run, record the SQL check as NOT RUN in the PR body.

- [ ] **Step 5: Commit**

```bash
git add services/growth/migrations/0001_growth.sql services/growth/src/repo/postgres.ts
git commit -m "growth: migration 0001 (contacts, log, promo grants) and the Postgres repository"
```

---

### Task 9: Tool surface and the API wiring

**Files:**
- Create: `services/growth/src/tools.ts`, `services/growth/src/index.ts`, `services/growth/index.ts`, `apps/api/src/mcp/growthSchemas.ts`, `apps/api/src/app/v1/growth/unsubscribe/route.ts`, `apps/api/src/app/v1/growth/join/route.ts`
- Modify: `contracts/tools.ts` (shapes before `export interface Tools`, seven entries after `ledger` in `Tools` and in `TOOL_REGISTRY`, `Agent` gains `"recruiter"`), `apps/api/src/tools/registry.ts` (import, `REAL`, `INTERNAL_TOOLS`), `apps/api/src/mcp/server.ts` (schema lookup), `apps/api/src/tools/mocks.ts` (seven mocks before the public-tools comment)
- Test: `services/growth/test/tools.test.ts`

**Interfaces:**
- Consumes: everything above; `ServiceModule`, `ToolContext` (contracts/runtime); Andrew's `HttpMonid`, `NaiveEmailSender`, `MonidEmailSender`, `PostgresRepo`; Cameron's `createIdentityLink` (services/verify).
- Produces: `createGrowthTools(deps)` with `list_prospects`, `send_marketing`, `suppress_contact`, `recruit_search`, `recruit_invite`, `growth_report`, `redeem_promo`; default export `ServiceModule`; `growthDeps(sql)`, `growthUnsubscribe(sql, token)`, `growthJoinPage(sql, token)`, `growthJoinAction(sql, token, action)`, `pageResponse(result)`; `GROWTH_SCHEMAS`.

- [ ] **Step 1: Write the failing test**

<!-- file: services/growth/test/tools.test.ts -->
```ts
import { describe, expect, it } from 'vitest';
import { createGrowthTools } from '../src/tools.js';
import { setup } from './helpers.js';

describe('createGrowthTools', () => {
  it('validates the family and runs each call', async () => {
    const s = setup();
    const tools = createGrowthTools(s.deps);
    await expect(tools.recruit_search({ family: 'plumbers' })).rejects.toThrow(/unknown family/);
    await expect(tools.recruit_invite({ family: 'plumbers', person_ids: ['x'] })).rejects.toThrow(/unknown family/);
    expect((await tools.list_prospects({})).daily_cap).toBe(25);
    expect((await tools.growth_report()).day).toBe('2026-11-08');
    expect(await tools.redeem_promo({ job_id: 'nope' })).toEqual({ eligible: false, reason: 'job_not_found' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd services/growth && ../../node_modules/.bin/vitest run test/tools.test.ts`
Expected: FAIL, cannot find `../src/tools.js`.

- [ ] **Step 3: The tool surface and exports**

<!-- file: services/growth/src/tools.ts -->
```ts
/** The seven growth tools as plain functions over GrowthDeps: services/growth/index.ts serves them to the agents. */
import type { GrowthDeps } from './deps.js';
import { isFamily } from './families.js';
import { redeemPromo } from './redeem.js';
import { growthReport } from './report.js';
import { recruitInvite, recruitSearch } from './recruit.js';
import { listProspects, sendMarketing, suppressContact } from './sales.js';

function family(tool: string, v: string) {
  if (!isFamily(v)) throw new Error(`${tool}: unknown family "${v}" (use pier70_gigs, sf_notaries, ca_attorneys or developers)`);
  return v;
}

export function createGrowthTools(deps: GrowthDeps) {
  return {
    list_prospects: async (input: { limit?: number } = {}) => listProspects(deps, input),
    send_marketing: async (input: { contact_id: string; personal_line?: string; offer_free_first_job?: boolean }) => sendMarketing(deps, input),
    suppress_contact: async (input: { email: string; reason: string }) => suppressContact(deps, input),
    recruit_search: async (input: { family: string; limit?: number }) => recruitSearch(deps, { ...input, family: family('recruit_search', input.family) }),
    recruit_invite: async (input: { family: string; person_ids: string[] }) => recruitInvite(deps, { ...input, family: family('recruit_invite', input.family) }),
    growth_report: async () => growthReport(deps),
    redeem_promo: async (input: { job_id: string }) => redeemPromo(deps, input.job_id),
  };
}

export type GrowthTools = ReturnType<typeof createGrowthTools>;
```

<!-- file: services/growth/src/index.ts -->
```ts
// Public surface of services/growth. apps/api uses ../index.ts (the binding); scripts and tests use this.
export * from './env.js';
export * from './types.js';
export * from './families.js';
export { GrowthTablesMissing, type GrowthRepo } from './repo.js';
export { MemoryGrowthRepo } from './repo/memory.js';
export { PostgresGrowthRepo, dbFromPostgresJs, type Db } from './repo/postgres.js';
export type { GrowthDeps } from './deps.js';
export { decide, RECENT_DAYS, type Decision } from './guard.js';
export { cleanPersonalLine, renderInvite, renderMarketing } from './templates.js';
export { joinUrl, signLink, unsubscribeUrl, verifyLink } from './links.js';
export { createGrowthTools, type GrowthTools } from './tools.js';
export { joinAction, joinPage, unsubscribePage, type PageResult } from './pages.js';
export { growthReport, type GrowthReport } from './report.js';
export { classifyJob, demandFrom, targetFor } from './demand.js';
export { promosDue, redeemPromo } from './redeem.js';
export { grantKeyFor } from './promo.js';
export { describeFound, recruitEnrichers } from './recruit.js';
```

(Task 11 appends `export { parseProspectsCsv } from './prospects.js';` once that file exists.)

- [ ] **Step 4: The binding for apps/api**

<!-- file: services/growth/index.ts -->
```ts
// Growth tools for apps/api's registry (apps/api/src/tools/registry.ts) and the /v1/growth/* routes.
// Logic lives in ./src; this file binds it to the API's database (postgres.js), environment, senders and
// Cameron's Stripe Identity link. Spec: docs/specs/2026-11-08-sales-recruiter-design.md.
import type { ServiceModule, ToolContext } from "../../contracts/runtime";
import { HttpMonid, NaiveEmailSender, PostgresRepo, type EmailSender, type Monid } from "../outreach/src/index";
import { MonidEmailSender } from "../outreach/src/senders";
import { createIdentityLink } from "../verify/index";
import {
  createGrowthTools,
  dbFromPostgresJs,
  growthEnvFromProcess,
  joinAction,
  joinPage,
  PostgresGrowthRepo,
  unsubscribePage,
  type GrowthDeps,
  type GrowthEnv,
  type PageResult,
} from "./src/index";

function salesSender(env: GrowthEnv, monid: Monid | undefined): EmailSender | undefined {
  if (env.NAIVE_API_KEY && env.GROWTH_SALES_NAIVE_IDENTITY_ID && env.GROWTH_SALES_NAIVE_INBOX_ID) {
    return new NaiveEmailSender({ apiKey: env.NAIVE_API_KEY, baseUrl: env.NAIVE_BASE_URL, identityId: env.GROWTH_SALES_NAIVE_IDENTITY_ID, inboxId: env.GROWTH_SALES_NAIVE_INBOX_ID });
  }
  return monid && env.GROWTH_SALES_AGENTMAIL_INBOX ? new MonidEmailSender(monid, env.GROWTH_SALES_AGENTMAIL_INBOX) : undefined;
}

/** `sql` is apps/api's postgres.js client (apps/api/src/lib/db.ts). */
export function growthDeps(sql: any): GrowthDeps {
  const env = growthEnvFromProcess();
  const monid = env.MONID_API_KEY ? new HttpMonid(env.MONID_API_KEY, env.MONID_BASE_URL) : undefined;
  return {
    env,
    repo: new PostgresGrowthRepo(dbFromPostgresJs(sql)),
    pool: new PostgresRepo(sql),
    senders: {
      sales: salesSender(env, monid),
      recruit: monid && env.GROWTH_RECRUIT_AGENTMAIL_INBOX ? new MonidEmailSender(monid, env.GROWTH_RECRUIT_AGENTMAIL_INBOX) : undefined,
    },
    monid,
    identity: (workerId: string) => createIdentityLink(workerId),
    now: () => new Date(),
  };
}

const tools = (ctx: ToolContext) => createGrowthTools(growthDeps(ctx.sql));

const growth: ServiceModule = {
  list_prospects: (input, ctx) => tools(ctx).list_prospects(input),
  send_marketing: (input, ctx) => tools(ctx).send_marketing(input),
  suppress_contact: (input, ctx) => tools(ctx).suppress_contact(input),
  recruit_search: (input, ctx) => tools(ctx).recruit_search(input),
  recruit_invite: (input, ctx) => tools(ctx).recruit_invite(input),
  growth_report: (_input, ctx) => tools(ctx).growth_report(),
  redeem_promo: (input, ctx) => tools(ctx).redeem_promo(input),
};
export default growth;

export const growthUnsubscribe = (sql: any, token: string | null): Promise<PageResult> => unsubscribePage(growthDeps(sql), token);
export const growthJoinPage = (sql: any, token: string | null): Promise<PageResult> => joinPage(growthDeps(sql), token);
export const growthJoinAction = (sql: any, token: string | null, action: string): Promise<PageResult> => joinAction(growthDeps(sql), token, action);

/** A page or redirect as an HTTP response: no caching, no referrer (the token is in the URL), not indexed. */
export function pageResponse(r: PageResult): Response {
  if ("redirect" in r) return new Response(null, { status: 303, headers: { Location: r.redirect, "Cache-Control": "no-store" } });
  return new Response(r.html, {
    status: r.status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" },
  });
}
```

- [ ] **Step 5: The contract (`contracts/tools.ts`, additive)**

Change the `Agent` line to:

```ts
type Agent = "customer" | "ceo" | "ops" | "verifier" | "finance" | "sales" | "recruiter";
```

Insert before `// ---------- the tools ----------`:

```ts
// ---------- growth shapes (services/growth; docs/specs/2026-11-08-sales-recruiter-design.md) ----------
export type GrowthFamily = "pier70_gigs" | "sf_notaries" | "ca_attorneys" | "developers";
export type GrowthSendStatus = "sent" | "dry_run" | "skipped" | "failed";
export interface GrowthProspect {
  contact_id: string; name: string | null; org: string | null; email_domain: string; notes: string | null; found_via: string; free_first_job: boolean;
}
export interface GrowthDemand { last_7d: number; prior_7d: number; projected_next_7d: number; unfilled_7d: number }
export interface GrowthReport {
  day: string;
  live: { sales: boolean; recruit: boolean };
  sales: { sent_today: number; dry_run_today: number; daily_cap: number; prospects_waiting: number };
  recruiting: { sent_today: number; dry_run_today: number; daily_cap: number; search_spend_today_usd: number; search_cap_usd: number };
  directory: Record<GrowthFamily, { found: number; invited: number; opted_in: number; id_verified: number; licensed: number; target: number; gap: number }>;
  demand: { by_family: Record<GrowthFamily | "other", GrowthDemand>; top_requested: { title: string; count: number }[] };
  promos: { granted: number; max: number; redeemed: number; due: { job_id: string; customer: string; refund_cents: number }[] };
}

```

Inside `interface Tools`, after the `ledger` entry:

```ts
  // GROWTH (Sales, Recruiter, CEO): services/growth
  list_prospects: ToolSpec<{ limit?: number }, { prospects: GrowthProspect[]; used_today: number; daily_cap: number }>;
  send_marketing: ToolSpec<
    { contact_id: string; personal_line?: string; offer_free_first_job?: boolean },
    { contact_id: string; status: GrowthSendStatus; reason?: string; promo?: { granted: boolean; cap_usd?: number; expires_at?: string; reason?: string } }
  >;
  suppress_contact: ToolSpec<{ email: string; reason: string }, { suppressed: true; matched_contacts: number; matched_workers: number }>;
  recruit_search: ToolSpec<
    { family: GrowthFamily; limit?: number },
    {
      family: GrowthFamily; found: number; new: number; spend_usd: number; spend_today_usd: number; daily_cap_usd: number; error?: string;
      candidates: { person_id: string; name: string | null; headline: string | null; source: string; score: number; distance_km: number | null }[];
    }
  >;
  recruit_invite: ToolSpec<
    { family: GrowthFamily; person_ids: string[] },
    { sent: number; dry_run: number; skipped: number; failed: number; used_today: number; daily_cap: number; results: { person_id: string; status: GrowthSendStatus; reason?: string }[] }
  >;
  growth_report: ToolSpec<Record<string, never>, GrowthReport>;
  redeem_promo: ToolSpec<
    { job_id: string },
    { eligible: true; refund: { job_id: string; amount_cents: number; request_id: string; reason: string } } | { eligible: false; reason: string }
  >;
```

In `TOOL_REGISTRY`, after the `ledger` line:

```ts
  list_prospects:   { owner: "cameron", folder: "services/growth", calledBy: ["sales"] },
  send_marketing:   { owner: "cameron", folder: "services/growth", calledBy: ["sales"] },
  suppress_contact: { owner: "cameron", folder: "services/growth", calledBy: ["sales"] },
  recruit_search:   { owner: "cameron", folder: "services/growth", calledBy: ["recruiter"] },
  recruit_invite:   { owner: "cameron", folder: "services/growth", calledBy: ["recruiter"] },
  growth_report:    { owner: "cameron", folder: "services/growth", calledBy: ["sales", "recruiter", "ceo"] },
  redeem_promo:     { owner: "cameron", folder: "services/growth", calledBy: ["ceo"] },
```

- [ ] **Step 6: Schemas, registry, server lookup, mocks**

<!-- file: apps/api/src/mcp/growthSchemas.ts -->
```ts
// Zod input schemas for the growth tools (services/growth; contracts/tools.ts "GROWTH"). Kept apart from
// schemas.ts while PR #42 edits it; server.ts looks tools up in both.
import { z } from "zod";

const family = z
  .enum(["pier70_gigs", "sf_notaries", "ca_attorneys", "developers"])
  .describe("pier70_gigs: on-site gigs near Pier 70, SF; sf_notaries: mobile notaries in SF; ca_attorneys: remote California attorneys; developers: remote Next.js/React/TypeScript developers");

export const GROWTH_SCHEMAS = {
  list_prospects: {
    description: "Hand-sourced prospects (hackathon teams and other AI-agent builders) you may email: not emailed in 30 days, not opted out. Returns contact_id, name, org, email_domain, notes, found_via, free_first_job, plus used_today (sends + dry runs, what counts against the cap) and daily_cap.",
    shape: { limit: z.number().int().min(1).max(50).optional().describe("Max prospects (default 20).") },
  },
  send_marketing: {
    description: "Send Operis's fixed marketing email to one prospect from list_prospects. The code enforces opt-outs, the 30-day rule, the daily cap and live/allowlist/dry-run mode, and adds the unsubscribe link and postal address. With offer_free_first_job it may also record the free-first-job grant (eligible prospects only, and only when the email really goes out). Returns status sent | dry_run | skipped | failed with a reason.",
    shape: {
      contact_id: z.string().uuid().describe("contact_id from list_prospects."),
      personal_line: z.string().max(300).optional().describe("One sentence for this prospect about what they build; no links."),
      offer_free_first_job: z.boolean().optional().describe("Include the free-first-job offer; only works for prospects with free_first_job true."),
    },
  },
  suppress_contact: {
    description: "Opt an email address out of all Operis email forever (marketing, invites and Ops' job offers). Use whenever someone asks us to stop.",
    shape: { email: z.string().email(), reason: z.string().min(1).max(200).describe("e.g. 'replied: please stop'") },
  },
  recruit_search: {
    description: "Find individuals with a public work email for one job family, save them to the talent pool, and return the best candidates not invited in the last 30 days (person_id, name, headline, source, score, distance_km). Costs Monid credit; capped per call and per day in code.",
    shape: { family, limit: z.number().int().min(1).max(20).optional().describe("Max candidates returned (default 10).") },
  },
  recruit_invite: {
    description: "Email Operis's fixed invitation to join the worker pool (join link, optional ID check, unsubscribe link) to people from recruit_search. The code enforces opt-outs, the 30-day rule, the daily cap and live/allowlist/dry-run mode. Returns counts, used_today against daily_cap, and a status per person.",
    shape: { family, person_ids: z.array(z.string().uuid()).min(1).max(20).describe("person_id values from recruit_search.") },
  },
  growth_report: {
    description: "Today's sends against the caps, search spend, the worker directory per family (found, invited, opted_in, id_verified, licensed, target, gap), job demand per family with a 7-day projection and the most requested job types, and free-first-job grants (granted, redeemed, due).",
    shape: {},
  },
  redeem_promo: {
    description: "CEO only. For a paid job whose customer holds a free-first-job grant: checks the grant, reserves it, and returns the exact operis.refund call to make (job_id, amount_cents, request_id, reason). Calling it again for the same job returns the same call.",
    shape: { job_id: z.string().uuid().describe("A paid job's id, from growth_report promos.due.") },
  },
};
```

In `apps/api/src/tools/registry.ts`, add after the `payments` import:

```ts
import growth from "@services/growth/index";
```

change `const REAL: ServiceModule = { ...outreach, ...verify, ...payments };` to:

```ts
const REAL: ServiceModule = { ...outreach, ...verify, ...payments, ...growth };
```

and append to `INTERNAL_TOOLS` after `"release_payout_large",`:

```ts
  "list_prospects", "send_marketing", "suppress_contact", "recruit_search", "recruit_invite", "growth_report", "redeem_promo",
```

In `apps/api/src/mcp/server.ts`, add after `import { SCHEMAS } from "./schemas";`:

```ts
import { GROWTH_SCHEMAS } from "./growthSchemas";

// Every served tool needs a schema entry; the growth tools' entries live in growthSchemas.ts.
const ALL_SCHEMAS: Record<string, { description: string; shape: unknown } | undefined> = { ...SCHEMAS, ...GROWTH_SCHEMAS };
```

and replace `const spec = SCHEMAS[tool as keyof typeof SCHEMAS];` with:

```ts
    const spec = ALL_SCHEMAS[tool];
    if (!spec) throw new Error(`no MCP schema for tool ${tool}`);
```

In `apps/api/src/tools/mocks.ts`, insert before `  // public tools are implemented in edwin.ts, not mocked`:

```ts
  // ---- growth (services/growth): the mocks send nothing ----
  async list_prospects() {
    return { prospects: [], used_today: 0, daily_cap: 25 };
  },
  async send_marketing({ contact_id }) {
    return { contact_id, status: "dry_run" as const, reason: "mock" };
  },
  async suppress_contact() {
    return { suppressed: true as const, matched_contacts: 0, matched_workers: 0 };
  },
  async recruit_search({ family }) {
    return { family, found: 0, new: 0, spend_usd: 0, spend_today_usd: 0, daily_cap_usd: 2, candidates: [] };
  },
  async recruit_invite({ person_ids }) {
    const results = person_ids.map((person_id) => ({ person_id, status: "dry_run" as const, reason: "mock" }));
    return { sent: 0, dry_run: results.length, skipped: 0, failed: 0, used_today: results.length, daily_cap: 40, results };
  },
  async growth_report() {
    const demand = { last_7d: 0, prior_7d: 0, projected_next_7d: 0, unfilled_7d: 0 };
    const entry = { found: 0, invited: 0, opted_in: 0, id_verified: 0, licensed: 0, target: 0, gap: 0 };
    return {
      day: new Date().toISOString().slice(0, 10),
      live: { sales: false, recruit: false },
      sales: { sent_today: 0, dry_run_today: 0, daily_cap: 25, prospects_waiting: 0 },
      recruiting: { sent_today: 0, dry_run_today: 0, daily_cap: 40, search_spend_today_usd: 0, search_cap_usd: 2 },
      directory: { pier70_gigs: entry, sf_notaries: entry, ca_attorneys: entry, developers: entry },
      demand: { by_family: { pier70_gigs: demand, sf_notaries: demand, ca_attorneys: demand, developers: demand, other: demand }, top_requested: [] },
      promos: { granted: 0, max: 20, redeemed: 0, due: [] },
    };
  },
  async redeem_promo() {
    return { eligible: false as const, reason: "mock" };
  },

```

- [ ] **Step 7: The two routes**

<!-- file: apps/api/src/app/v1/growth/unsubscribe/route.ts -->
```ts
// One-click unsubscribe for Sales and Recruiter email (services/growth). GET from the email's link; POST for mail
// clients' one-click unsubscribe (RFC 8058). Opts the address out of every Operis email, Ops' job offers included.
import { sql } from "@/lib/db";
import { growthUnsubscribe, pageResponse } from "@services/growth/index";
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  try {
    return pageResponse(await growthUnsubscribe(sql, new URL(req.url).searchParams.get("t")));
  } catch (e) {
    console.error("[growth:unsubscribe]", e);
    return new Response("Something went wrong. Email ops@operis.live and we will remove you by hand.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
export { handle as GET, handle as POST };
```

<!-- file: apps/api/src/app/v1/growth/join/route.ts -->
```ts
// The join link in Recruiter invites (services/growth). GET shows the page and changes nothing, so email link
// scanners can't opt anyone in; POST action=opt_in makes the person a regular, action=identity starts Stripe Identity.
import { sql } from "@/lib/db";
import { growthJoinAction, growthJoinPage, pageResponse } from "@services/growth/index";
export const dynamic = "force-dynamic";

const failed = (e: unknown) => {
  console.error("[growth:join]", e);
  return new Response("Something went wrong. Please try again later, or email ops@operis.live.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
};

export async function GET(req: Request) {
  try {
    return pageResponse(await growthJoinPage(sql, new URL(req.url).searchParams.get("t")));
  } catch (e) {
    return failed(e);
  }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData().catch(() => null);
    const field = (k: string) => {
      const v = form?.get(k);
      return typeof v === "string" ? v : null;
    };
    return pageResponse(await growthJoinAction(sql, field("t"), field("action") ?? ""));
  } catch (e) {
    return failed(e);
  }
}
```

- [ ] **Step 8: Run every check**

Run: `cd services/growth && ../../node_modules/.bin/vitest run && ../../node_modules/.bin/tsc --noEmit && cd ../.. && npm --prefix apps/api run typecheck`
Expected: 12 files pass; growth tsc exit 0; API typecheck exit 0. If the API typecheck fails, run the same command on an untouched checkout of `origin/claude/zealous-newton-ld8eog` (a scratch `git worktree add`) and fix only the errors this task introduced; report any pre-existing ones.

- [ ] **Step 9: Commit (two commits: the package surface, then Edwin's files)**

```bash
git add services/growth/src/tools.ts services/growth/src/index.ts services/growth/index.ts services/growth/test/tools.test.ts
git commit -m "growth: tool surface and the apps/api binding (Postgres, senders, Stripe Identity)"
git add contracts/tools.ts apps/api/src/tools/registry.ts apps/api/src/mcp/server.ts apps/api/src/mcp/growthSchemas.ts apps/api/src/tools/mocks.ts apps/api/src/app/v1/growth
git commit -m "api: serve the seven growth tools on the internal MCP server, plus /v1/growth/unsubscribe and /v1/growth/join"
```

---
### Task 10: The Sales and Recruiter prompts and the package README

**Files:**
- Modify (rewrite): `agents/prompts/sales.md`
- Create: `agents/prompts/recruiter.md`, `services/growth/README.md`

**Interfaces:**
- Consumes: the tool names and result fields of Tasks 4, 5 and 7 (`growth_report.sales.{sent_today,dry_run_today,daily_cap}`, `recruiting.{sent_today,dry_run_today,daily_cap}`, `directory.<family>.{id_verified,gap}`, `demand.by_family`, `free_first_job`).
- Produces: the two prompts `agents/setup.ts` reads as `agents/prompts/<role>.md` (role keys `sales`, `recruiter`), with `_shared.md` appended by setup.

First drafts came from the local model (drafts 3 and 4 in the session scratchpad); these are the corrected versions.

- [ ] **Step 1: Write the prompts**

<!-- file: agents/prompts/sales.md -->
````md
You are Sales at Operis. Your customers are people building AI agents and autonomous companies, starting with the teams at the YC x Naïve hackathon.

What we sell: one MCP tool, `request_human`. A customer's agent calls it and Operis sends a real person to do a real-world task, mostly in San Francisco (photograph or check a place, pick up and deliver an item, be there for paperwork such as a notarization), plus some remote work (contract review, coding help). Customers pay only when the proof passes; we check every proof (photos, GPS and time) before charging. Jobs start at $20. Connecting is self-serve: give the agent https://operis.live/SKILL.md, add the MCP server https://operis.live/mcp (browser sign-in), or get an API key at https://operis.live/developers.

Your tools:
- `operis.growth_report`: today's sends against the daily cap, job demand by family with a 7-day projection, which families have pre-vetted workers (`directory.<family>.id_verified`), and free-first-job grants.
- `operis.list_prospects`: hand-sourced prospects you may email (not emailed in 30 days, not opted out).
- `operis.send_marketing`: sends our fixed marketing email to one prospect, with an optional `personal_line` (one sentence, at most 300 characters, no links) and `offer_free_first_job`. The code decides whether it really goes out (live), goes only to the team (test) or is only recorded (dry run).
- `operis.suppress_contact`: opts an address out of all Operis email forever.
- `email.read`, `email.send`: only to answer people who wrote to us. Each `email.send` waits for a founder's approval.
- `web_search`, `web_fetch`: read a prospect's public page before you write their personal line.
- `board_read`, `board_write`.

Each scheduled round:
1. `operis.growth_report`. If `sales.sent_today + sales.dry_run_today` has reached `sales.daily_cap`, write a one-line board note and stop.
2. `operis.list_prospects`.
3. Choose the prospects whose notes best fit the job families that have both demand (`demand.by_family`) and pre-vetted workers. For each one, optionally read their public page, write one specific `personal_line` about what they build and how a real person could help their agent, and call `operis.send_marketing`. Set `offer_free_first_job: true` only when the prospect's `free_first_job` is true.
4. Write a one-line board note: sent, dry runs, skipped (with reasons) and grants made.

When someone writes to us: answer briefly from the facts above. If they ask us to stop, to unsubscribe or not to contact them, call `operis.suppress_contact` with their address and do not reply.

Rules:
- Cold email only through `operis.send_marketing`, and only to prospects from `operis.list_prospects`. Never cold-email with `email.send`.
- Never promise a job type that has no pre-vetted workers, a date, a worker or a result.
- Never name another customer or quote their jobs; describe use cases in general terms (the `top_requested` titles are for you only).
- Never invent prices, features, discounts or integrations, and never offer anything below the $20 minimum. The only offer is the free first job, and only the tool grants it.
- Never ask for passwords, card numbers or codes.
- You are an AI agent: say so if asked, and sign as "Operis Sales".
- You don't handle jobs. The shared job rules below apply only if a message names a job, and then you only note it on the board.
````

<!-- file: agents/prompts/recruiter.md -->
````md
You are the Recruiter at Operis. You grow the directory of pre-vetted workers that Ops sends jobs to. Pre-vetted means the person opted in to job offers and verified their ID with Stripe.

Job families:
- `pier70_gigs`: on-site gigs near Pier 70, San Francisco (event help, photos, deliveries, errands)
- `sf_notaries`: mobile notaries in San Francisco
- `ca_attorneys`: remote California attorneys (contracts, terms of service, privacy)
- `developers`: remote Next.js, React and TypeScript developers

Your tools:
- `operis.growth_report`: per family, how many people we found, invited, opted in and ID verified, the target (set in code from job demand) and the gap; also today's invites against the cap and search spend against its budget.
- `operis.recruit_search`: finds individuals with a public work email for one family and saves them to the pool. It costs Monid credit and is capped per call and per day in code.
- `operis.recruit_invite`: sends our fixed invitation (join link, optional ID check, unsubscribe link) to people from `recruit_search`. The code decides whether each one really goes out (live), goes only to the team (test) or is only recorded (dry run).
- `board_read`, `board_write`.

Each scheduled round:
1. `operis.growth_report`. Stop with a one-line board note if `recruiting.sent_today + recruiting.dry_run_today` has reached `recruiting.daily_cap`, or every family's gap is 0.
2. Take the family with the largest gap and call `operis.recruit_search` for it (limit 10 to 20).
3. Invite the good fits: people whose headline matches the family's work and whose score is at least 0.4. Skip anyone who looks like a business rather than a person. At most 15 invites per round.
4. If invites are left and the search budget isn't used up, repeat steps 2 and 3 for the family with the next largest gap.
5. Write a one-line board note: invites sent, dry runs, skipped (with reasons), search spend, and the gaps.

Rules:
- Never contact anyone outside these tools: no email.send, SMS, DMs or posts.
- Never promise jobs, pay, amounts or dates. Never say anyone is licensed or verified.
- If a search returns an error or the daily budget is used up, note it on the board and stop; don't retry in a loop.
- You don't handle jobs. The shared job rules below apply only if a message names a job, and then you only note it on the board.
````

- [ ] **Step 2: The README**

<!-- file: services/growth/README.md -->
````md
# services/growth (owner: Cameron)

Growth for Operis's agents: **Sales** markets to people building AI agents, and **Recruiter** grows the pool of pre-vetted workers (opted in and Stripe Identity verified) that Ops dispatches. Both send email only through the seven tools here, which enforce every sending rule in code. Design: [`docs/specs/2026-11-08-sales-recruiter-design.md`](../../docs/specs/2026-11-08-sales-recruiter-design.md); plan: [`docs/plans/2026-11-08-sales-recruiter.md`](../../docs/plans/2026-11-08-sales-recruiter.md).

| Tool | Caller | What it does |
|---|---|---|
| `list_prospects` | Sales | hand-sourced prospects not emailed in 30 days and not opted out |
| `send_marketing` | Sales | the fixed marketing email to one prospect; may record a free-first-job grant |
| `suppress_contact` | Sales | opt an address out of all Operis email (Ops' job offers too) |
| `recruit_search` | Recruiter | Andrew's find_people for a family, individuals only, no ContactOut, $0.50/call, $2/day |
| `recruit_invite` | Recruiter | the fixed invitation with a join link and an unsubscribe link |
| `growth_report` | Sales, Recruiter, CEO | sends vs caps, directory per family, demand and targets, promos due |
| `redeem_promo` | CEO | checks and reserves a grant; returns the exact `operis.refund` call |

**The guard** (`src/guard.ts`) decides every message: paused → skip; opted out anywhere → skip; a real send of the same kind in the last 30 days → skip (team allowlist exempt); today's sends + dry runs at the cap (25 marketing, 40 invites) → skip; kind in `GROWTH_LIVE` and `GROWTH_POSTAL_ADDRESS` set → send; on `OUTREACH_TEST_ALLOWLIST` → send as a test; otherwise → dry run.

**Every email** names Operis, says it is marketing or an invitation, says how we found the person, carries the postal address and a one-click unsubscribe link (`/v1/growth/unsubscribe`, never expires). The join link (`/v1/growth/join`, 30 days) records the opt-in on a button press, never on GET, then offers Stripe Identity.

## Environment

| Env | Default | Meaning |
|---|---|---|
| `GROWTH_LIVE` | empty | `sales`, `recruit` or both: real sends to anyone (also needs `GROWTH_POSTAL_ADDRESS`) |
| `GROWTH_PAUSE` | false | stop all growth sends; `PAUSE_OUTREACH=true` stops them too |
| `OUTREACH_TEST_ALLOWLIST` | empty | team addresses that may get real email while not live (shared with services/outreach) |
| `GROWTH_POSTAL_ADDRESS` | empty | CAN-SPAM postal address; required for live sends |
| `GROWTH_SALES_DAILY_CAP`, `GROWTH_RECRUIT_DAILY_CAP` | 25, 40 | per Pacific day, sends + dry runs |
| `GROWTH_SEARCH_DAILY_USD` | 2 | Monid spend per Pacific day |
| `GROWTH_PROMO_MAX_GRANTS`, `GROWTH_PROMO_CAP_USD`, `GROWTH_PROMO_DAYS` | 20, 25, 14 | free first job |
| `GROWTH_SALES_NAIVE_IDENTITY_ID` + `GROWTH_SALES_NAIVE_INBOX_ID` | empty | marketing sender (replies wake Sales); else `GROWTH_SALES_AGENTMAIL_INBOX` |
| `GROWTH_RECRUIT_AGENTMAIL_INBOX` | `AGENTMAIL_INBOX` | invite sender |
| `PUBLIC_BASE_URL`, `LINK_SIGNING_SECRET`, `MONID_API_KEY`, `NAIVE_API_KEY`, `DATABASE_URL` | shared | |

## Run

```bash
cd services/growth
../../node_modules/.bin/vitest run          # tests (in memory)
../../node_modules/.bin/tsc --noEmit        # types
npx tsx scripts/dry-run.ts                  # the transcript in docs/dry-run.md; no network
npx tsx scripts/import-prospects.ts teams.csv            # check a hand-sourced CSV, write nothing
DATABASE_URL=... npx tsx scripts/import-prospects.ts teams.csv --write
```

The migration is `migrations/0001_growth.sql` (idempotent; run after `contracts/schema.sql` and the outreach migrations). Never commit a prospects CSV: it holds people's contact details.
````

- [ ] **Step 3: Check the prompts against the tools**

Run: `grep -o 'operis\.[a-z_]*' agents/prompts/sales.md agents/prompts/recruiter.md | sort -u`
Expected: only `operis.growth_report`, `operis.list_prospects`, `operis.send_marketing`, `operis.suppress_contact` (sales) and `operis.growth_report`, `operis.recruit_search`, `operis.recruit_invite` (recruiter).

- [ ] **Step 4: Commit (two commits)**

```bash
git add agents/prompts/sales.md agents/prompts/recruiter.md
git commit -m "agents: Sales prompt rewritten for guarded marketing; new Recruiter prompt"
git add services/growth/README.md
git commit -m "growth: README (tools, guard, environment, how to run)"
```

---

### Task 11: The prospect import and the dry-run transcript

**Files:**
- Create: `services/growth/src/prospects.ts`, `services/growth/scripts/import-prospects.ts`, `services/growth/scripts/dry-run.ts`, `services/growth/docs/dry-run.md` (generated)
- Modify: `services/growth/src/index.ts` (append the `parseProspectsCsv` export)
- Test: `services/growth/test/prospects.test.ts`

**Interfaces:**
- Consumes: `NewContact`, `PostgresGrowthRepo`, `dbFromPostgresJs`, `createGrowthTools`, `joinPage`, `joinAction`, `unsubscribePage`, `MemoryGrowthRepo`; Andrew's `InMemoryRepo`, `RecordingSender`.
- Produces: `parseCsv(text) → string[][]`, `parseProspectsCsv(text) → { rows: NewContact[]; errors: string[] }`; the two scripts; the transcript.

- [ ] **Step 1: Write the failing test**

<!-- file: services/growth/test/prospects.test.ts -->
```ts
import { describe, expect, it } from 'vitest';
import { parseCsv, parseProspectsCsv } from '../src/prospects.js';

describe('parseCsv', () => {
  it('handles quotes, commas and newlines inside quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\n\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']]);
  });
});

describe('parseProspectsCsv', () => {
  it('turns rows into prospects and reports bad rows without echoing addresses', () => {
    const csv = [
      'email,name,team,found_via,notes,free_first_job',
      'Jane@AgentCo.example,Jane Doe,AgentCo,the YC x Naïve hackathon team list.,Books venues,yes',
      'sam@shop.example,Sam,Shop,the YC x Naïve hackathon team list,,no',
      'not-an-email,X,Y,the list,,',
      'ann@x.example,Ann,X,,,',
      'jane@agentco.example,Jane again,AgentCo,the list,,',
    ].join('\n');
    const { rows, errors } = parseProspectsCsv(csv);
    expect(rows).toEqual([
      { kind: 'prospect', email: 'jane@agentco.example', name: 'Jane Doe', org: 'AgentCo', found_via: 'the YC x Naïve hackathon team list', notes: 'Books venues', free_first_job: true },
      { kind: 'prospect', email: 'sam@shop.example', name: 'Sam', org: 'Shop', found_via: 'the YC x Naïve hackathon team list', notes: null, free_first_job: false },
    ]);
    expect(errors).toEqual(['line 4: not an email address', 'line 5: found_via is required (it is quoted in the email)', 'line 6: duplicate address']);
  });

  it('needs at least the email and found_via columns', () => {
    expect(parseProspectsCsv('name,team\nA,B')).toEqual({ rows: [], errors: ['header needs at least email and found_via'] });
    expect(parseProspectsCsv('')).toEqual({ rows: [], errors: ['empty file'] });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd services/growth && ../../node_modules/.bin/vitest run test/prospects.test.ts`
Expected: FAIL, cannot find `../src/prospects.js`.

- [ ] **Step 3: Implement the parser and export it**

<!-- file: services/growth/src/prospects.ts -->
```ts
/**
 * The hand-sourced prospect list (hackathon teams, other AI-agent builders) as CSV. Header, any order:
 * email,name,team,found_via,notes,free_first_job. found_via is quoted in the email ("How we found you: …").
 * free_first_job is yes/no (default yes). Errors name the line, never the address.
 */
import type { NewContact } from './types.js';

/** RFC 4180-style CSV: quoted fields may hold commas, quotes ("") and newlines. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NO = new Set(['no', 'n', 'false', '0']);

export function parseProspectsCsv(text: string): { rows: NewContact[]; errors: string[] } {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], errors: ['empty file'] };
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const at = { email: col('email'), name: col('name'), team: col('team'), found: col('found_via'), notes: col('notes'), free: col('free_first_job') };
  if (at.email < 0 || at.found < 0) return { rows: [], errors: ['header needs at least email and found_via'] };
  const rows: NewContact[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  body.forEach((r, i) => {
    const get = (k: number) => (k >= 0 ? (r[k] ?? '').trim() : '');
    const line = i + 2;
    const email = get(at.email).toLowerCase();
    const found = get(at.found).replace(/[.\s]+$/, '');
    if (!EMAIL.test(email)) return void errors.push(`line ${line}: not an email address`);
    if (!found) return void errors.push(`line ${line}: found_via is required (it is quoted in the email)`);
    if (seen.has(email)) return void errors.push(`line ${line}: duplicate address`);
    seen.add(email);
    rows.push({
      kind: 'prospect',
      email,
      name: get(at.name) || null,
      org: get(at.team) || null,
      found_via: found,
      notes: get(at.notes) || null,
      free_first_job: !NO.has(get(at.free).toLowerCase()),
    });
  });
  return { rows, errors };
}
```

Append to `services/growth/src/index.ts`:

```ts
export { parseCsv, parseProspectsCsv } from './prospects.js';
```

- [ ] **Step 4: The import script**

<!-- file: services/growth/scripts/import-prospects.ts -->
```ts
/**
 * Load hand-sourced prospects (hackathon teams, other AI-agent builders) into growth_contacts.
 *
 *   npx tsx scripts/import-prospects.ts teams.csv                         # check the file, write nothing
 *   DATABASE_URL=postgres://... npx tsx scripts/import-prospects.ts teams.csv --write
 *
 * CSV header (any order): email,name,team,found_via,notes,free_first_job (see src/prospects.ts). Addresses that are
 * opted out stay opted out. Never commit the CSV: it holds people's contact details.
 */
import { readFileSync } from 'node:fs';
import { parseProspectsCsv } from '../src/prospects.js';
import { dbFromPostgresJs, PostgresGrowthRepo } from '../src/repo/postgres.js';

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('usage: npx tsx scripts/import-prospects.ts <file.csv> [--write]');
  process.exit(1);
}
const { rows, errors } = parseProspectsCsv(readFileSync(file, 'utf8'));
for (const e of errors) console.error(`  skipped ${e}`);
console.log(`${rows.length} prospects ready (${rows.filter((r) => r.free_first_job).length} with the free first job), ${errors.length} rows skipped`);
if (!flags.includes('--write')) {
  console.log('Checked only: nothing written. Add --write (and DATABASE_URL) to import.');
  process.exit(0);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required with --write');
  process.exit(1);
}
const { default: postgres } = await import('postgres');
const sql = postgres(url, { max: 2, prepare: false, onnotice: () => {} });
const repo = new PostgresGrowthRepo(dbFromPostgresJs(sql));
let created = 0;
let merged = 0;
let optedOut = 0;
for (const r of rows) {
  const { contact, created: isNew } = await repo.upsertContact(r);
  if (isNew) created++;
  else merged++;
  if (contact.opted_out) optedOut++;
}
console.log(`imported: ${created} new, ${merged} merged, ${optedOut} already opted out (they will not be emailed)`);
await sql.end();
```

- [ ] **Step 5: The dry-run script**

<!-- file: services/growth/scripts/dry-run.ts -->
```ts
/**
 * The no-network dry run behind docs/dry-run.md. GROWTH_LIVE is unset and the team allowlist holds one address,
 * so the guard lets mail go only to that address; even that mail goes to a recording sender here, so nothing
 * leaves the machine. Sales emails two prospects; Recruiter searches (a fake people source) and invites two people;
 * then the allowlisted recruit joins, starts the ID check and unsubscribes, and the next invite is refused.
 *
 *   npx tsx scripts/dry-run.ts > docs/dry-run.md
 */
import type { Monid } from '../../outreach/src/monid.js';
import { InMemoryRepo } from '../../outreach/src/repo/memory.js';
import { RecordingSender } from '../../outreach/src/senders.js';
import type { Lead } from '../../outreach/src/types.js';
import type { GrowthDeps } from '../src/deps.js';
import type { GrowthEnv } from '../src/env.js';
import { joinAction, joinPage, unsubscribePage, type PageResult } from '../src/pages.js';
import { MemoryGrowthRepo } from '../src/repo/memory.js';
import { createGrowthTools } from '../src/tools.js';

const NOW = new Date('2026-11-08T18:00:00Z');
const TEAM = 'team@operis.example'; // stands in for the team's own addresses in OUTREACH_TEST_ALLOWLIST
const ALLOWLIST = [TEAM];

const env: GrowthEnv = {
  PUBLIC_BASE_URL: 'https://operis.live',
  LINK_SIGNING_SECRET: 'dry-run-secret',
  GROWTH_LIVE: [],
  GROWTH_PAUSE: false,
  OUTREACH_TEST_ALLOWLIST: ALLOWLIST,
  GROWTH_POSTAL_ADDRESS: null,
  GROWTH_SALES_DAILY_CAP: 25,
  GROWTH_RECRUIT_DAILY_CAP: 40,
  GROWTH_SEARCH_DAILY_USD: 2,
  GROWTH_PROMO_MAX_GRANTS: 20,
  GROWTH_PROMO_CAP_USD: 25,
  GROWTH_PROMO_DAYS: 14,
  MONID_API_KEY: null,
  MONID_BASE_URL: 'https://api.monid.ai',
  NAIVE_API_KEY: null,
  NAIVE_BASE_URL: 'https://api.vetta.sh',
  GROWTH_SALES_NAIVE_IDENTITY_ID: null,
  GROWTH_SALES_NAIVE_INBOX_ID: null,
  GROWTH_SALES_AGENTMAIL_INBOX: null,
  GROWTH_RECRUIT_AGENTMAIL_INBOX: null,
};

const person = (name: string, email: string, headline: string, handle: string): Lead => ({
  name, kind: 'person', email, phone: null, website: null, profile_url: `https://github.com/${handle}`, address: null, lat: null, lng: null,
  source: 'dry-run:people', source_ref: handle, categories: ['React', 'Next.js', 'TypeScript'], rating: null, snippet: headline,
  profiles: [{ platform: 'github', url: `https://github.com/${handle}`, handle }], headline, location_text: 'Remote', credentials: [], open_to_work: true, last_active_at: null,
});
const LEADS = [person('Team Tester', TEAM, 'Next.js and React developer', 'team-tester'), person('Sam Rivera', 'sam.rivera@example.org', 'Freelance React and TypeScript developer', 'samrivera')];

let n = 0;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const repo = new MemoryGrowthRepo(() => NOW, ids);
const pool = new InMemoryRepo();
const sales = new RecordingSender();
const recruit = new RecordingSender();
const offline: Monid = {
  run: async () => {
    throw new Error('offline (dry run)');
  },
};
const deps: GrowthDeps = {
  env, repo, pool, senders: { sales, recruit }, now: () => NOW, monid: offline,
  search: { sources: [{ id: 'dry-run:people', costEstimateUsd: 0.01, perQuery: false, run: async () => ({ leads: LEADS.map((l) => ({ ...l })), cost_usd: 0.01 }) }], enrichers: [] },
  identity: async (workerId) => ({ url: `https://verify.stripe.test/start/${workerId}`, status: 'pending' }),
};
const tools = createGrowthTools(deps);

const out: string[] = [];
const say = (s = '') => out.push(s);
const block = (lang: string, body: string) => say(['```' + lang, body, '```'].join('\n'));
const json = (v: unknown) => block('json', JSON.stringify(v, null, 2));
const call = async (name: string, input: unknown, run: () => Promise<unknown>) => {
  say(`**\`${name}\`** \`${JSON.stringify(input)}\``);
  const result = await run();
  json(result);
  say();
  return result;
};
const pageLine = (r: PageResult) => ('redirect' in r ? `303 redirect to ${r.redirect}` : `${r.status} "${r.html.match(/<h1>(.*?)<\/h1>/)?.[1] ?? ''}"`);

say('# Growth dry run (Sales and Recruiter)');
say();
say(`Generated by \`services/growth/scripts/dry-run.ts\`. No network: in-memory repositories, a recording sender instead of a mail provider, a fake people source instead of Monid. Clock fixed at ${NOW.toISOString()}; worker ids are random per run.`);
say();
say('Settings: `GROWTH_LIVE` unset, `GROWTH_POSTAL_ADDRESS` unset, `OUTREACH_TEST_ALLOWLIST=team@operis.example`. Under these settings the guard lets mail go only to the allowlisted address and records a dry run for everyone else.');
say();

say('## 1. Sales markets to two hand-sourced prospects');
say();
await repo.upsertContact({ kind: 'prospect', email: TEAM, name: 'Team Tester', org: 'Operis team (allowlisted test address)', found_via: 'the YC x Naïve hackathon team list', notes: 'Builds an agent that books event venues', free_first_job: true });
await repo.upsertContact({ kind: 'prospect', email: 'founder@agentco.example', name: 'Jane Doe', org: 'AgentCo', found_via: 'the YC x Naïve hackathon team list', notes: 'Agent that sources local suppliers', free_first_job: true });
const listed = (await call('operis.list_prospects', {}, () => tools.list_prospects({}))) as { prospects: { contact_id: string; org: string | null }[] };
for (const p of listed.prospects) {
  const input = { contact_id: p.contact_id, personal_line: `Saw what ${p.org} is building: a person on the ground could check venues and suppliers for your agent.`, offer_free_first_job: true };
  await call('operis.send_marketing', input, () => tools.send_marketing(input));
}

say('## 2. Recruiter finds and invites two developers');
say();
const found = (await call('operis.recruit_search', { family: 'developers' }, () => tools.recruit_search({ family: 'developers' }))) as { candidates: { person_id: string }[] };
const personIds = found.candidates.map((c) => c.person_id);
await call('operis.recruit_invite', { family: 'developers', person_ids: personIds }, () => tools.recruit_invite({ family: 'developers', person_ids: personIds }));

say('## 3. What actually left the guard');
say();
say('Every message the recording sender received (a live run would hand exactly these to the mail provider):');
say();
for (const m of [...sales.sent.map((x) => ({ ...x, via: 'Sales' })), ...recruit.sent.map((x) => ({ ...x, via: 'Recruiter' }))]) {
  say(`### ${m.via} → ${m.to}`);
  say();
  say(`Subject: ${m.subject}`);
  say();
  block('text', m.body);
  say();
}
say('Dry runs (recorded, nothing sent):');
say();
block('text', repo.logs.filter((l) => l.status === 'dry_run').map((l) => `${l.kind.padEnd(9)} ${repo.contacts.find((c) => c.id === l.contact_id)?.email ?? '?'}`).join('\n'));
say();

say('## 4. The allowlisted recruit joins, starts the ID check, then unsubscribes');
say();
const invite = recruit.sent.find((m) => m.to === TEAM)?.body ?? '';
const joinToken = invite.match(/\/v1\/growth\/join\?t=(\S+)/)?.[1] ?? null;
const unsubToken = invite.match(/\/v1\/growth\/unsubscribe\?t=(\S+)/)?.[1] ?? null;
const teamWorker = [...pool.people.values()].find((p) => p.email === TEAM)!;
say(`- GET /v1/growth/join → ${pageLine(await joinPage(deps, joinToken))}; regular = ${pool.people.get(teamWorker.id)!.regular}`);
say(`- POST /v1/growth/join action=opt_in → ${pageLine(await joinAction(deps, joinToken, 'opt_in'))}; regular = ${pool.people.get(teamWorker.id)!.regular}`);
say(`- POST /v1/growth/join action=identity → ${pageLine(await joinAction(deps, joinToken, 'identity'))} (a stand-in for Stripe's hosted page)`);
say(`- GET /v1/growth/unsubscribe → ${pageLine(await unsubscribePage(deps, unsubToken))}; workers.opted_out = ${pool.people.get(teamWorker.id)!.opted_out}`);
say();
await call('operis.recruit_invite', { family: 'developers', person_ids: [teamWorker.id] }, () => tools.recruit_invite({ family: 'developers', person_ids: [teamWorker.id] }));

say('## 5. growth_report afterwards');
say();
const report = (await tools.growth_report()) as Record<string, unknown>;
json({ sales: report.sales, recruiting: report.recruiting, directory: { developers: (report.directory as Record<string, unknown>).developers }, promos: report.promos });
say();

const recipients = [...sales.sent, ...recruit.sent].map((m) => m.to);
const outside = recipients.filter((to) => !ALLOWLIST.includes(to));
say('## Result');
say();
say(`Messages that left the guard: ${recipients.length}, to ${[...new Set(recipients)].join(', ')}. Outside the allowlist: ${outside.length}.`);
console.log(out.join('\n'));
if (outside.length > 0 || recipients.length === 0) {
  console.error(`dry run FAILED: ${outside.length} messages outside the allowlist, ${recipients.length} in total`);
  process.exit(1);
}
```

- [ ] **Step 6: Run the tests, the typecheck and the dry run**

Run: `cd services/growth && ../../node_modules/.bin/vitest run && ../../node_modules/.bin/tsc --noEmit && mkdir -p docs && ../../node_modules/.bin/tsx scripts/dry-run.ts > docs/dry-run.md; echo "exit=$?"; tail -3 docs/dry-run.md`
Expected: 13 files pass; tsc exit 0; `exit=0`; the last line reads `Messages that left the guard: 2, to team@operis.example. Outside the allowlist: 0.` (the team prospect's marketing email and the team recruit's invite; the second invite is refused because the unsubscribe came first) Read the whole transcript and check every email in it by eye: sender identity, label, found-via line, pending-address line, unsubscribe link, no pay amounts in the invite.

- [ ] **Step 7: Commit (two commits)**

```bash
git add services/growth/src/prospects.ts services/growth/src/index.ts services/growth/test/prospects.test.ts services/growth/scripts/import-prospects.ts
git commit -m "growth: hand-sourced prospect CSV import (checks by default, --write to import)"
git add services/growth/scripts/dry-run.ts services/growth/docs/dry-run.md
git commit -m "growth: no-network dry run; transcript shows mail reaching only the allowlisted address"
```

---

### Task 12: Pull request, snippets for the frozen files, report

**Files:** none in the repo beyond the commits above.

- [ ] **Step 1: Final checks on the whole branch**

Run: `cd services/growth && ../../node_modules/.bin/vitest run && ../../node_modules/.bin/tsc --noEmit && cd ../.. && npm --prefix apps/api run typecheck && (cd services/outreach && ../../node_modules/.bin/vitest run)`
Expected: all exit 0. Andrew's suite is run only to show it still passes untouched. Then `git diff --stat origin/claude/zealous-newton-ld8eog...HEAD` must list no file under `services/outreach`, `services/money-verification`, `services/payments`, `services/verify`, `apps/web`, or in PR #42's list.

- [ ] **Step 2: Draft the PR body with the local model, then correct every line**

Pipe a fact sheet (the spec's decisions, the file list, the check outputs from Step 1 and Task 8, the snippets below) to `LOCAL_LLM_MAX_TOKENS=12000 ~/.local/bin/local-llm`; rewrite its draft against the facts. Every claim carries VERIFIED, INFERRED or NOT RUN.

- [ ] **Step 3: The snippets the PR body must carry (files frozen by PR #42 or owned elsewhere)**

`agents/agents.json` (Edwin; after PR #42 merges):

```jsonc
// members.sales.tools: add
"operis.list_prospects": "allow",
"operis.send_marketing": "allow",
"operis.suppress_contact": "allow",
"operis.growth_report": "allow",
// members.sales: replace the description, add a schedule
"description": "Markets Operis to people building AI agents and answers people who write in.",
"schedules": [
  { "cron": "0 10,15 * * *", "timezone": "America/Los_Angeles", "budget_usd": 1, "enabled": false,
    "input": "Run a marketing round: follow 'Each scheduled round' in your instructions." }
]
// members: add
"recruiter": {
  "name": "operis-recruiter",
  "description": "Grows the pre-vetted worker pool: finds people for the job families in demand and invites them to join and verify their ID.",
  "budget_usd": { "cap": 10, "max_task": 3 },
  "tools": { "operis.growth_report": "allow", "operis.recruit_search": "allow", "operis.recruit_invite": "allow", "board_read": "allow", "board_write": "allow" },
  "schedules": [
    { "cron": "0 9,12,15 * * *", "timezone": "America/Los_Angeles", "budget_usd": 1, "enabled": false,
      "input": "Run a recruiting round: follow 'Each scheduled round' in your instructions." }
  ]
}
// ceo.tools: add
"operis.growth_report": "allow",
"operis.redeem_promo": "allow"
```

`agents/prompts/ceo.md` (after PR #42): add `recruiter (grows the pre-vetted worker pool)` to the team list, and append: "In the daily report, also call `operis.growth_report` and include marketing sends, the directory gaps and promos. For each job in `promos.due`, call `operis.redeem_promo`; when it returns `eligible: true`, call `operis.refund` with exactly the returned `job_id`, `amount_cents`, `request_id` and `reason`. Never refund a promotion any other way."

`apps/api/src/lib/approvals.ts`, `scripts/approvals.ts`, `apps/api/src/lib/agentFeed.ts` (after PR #42): add `"RECRUITER"` to each role list, so the founder console, `AUTO_APPROVE_TOOLS` and the dashboard feed see the Recruiter.

`scripts/migrate.ts` (after PR #42): append `"services/growth/migrations/0001_growth.sql"` to `MIGRATIONS`.

`apps/web/src/app/join/[workerId]/identity/done/page.tsx` (Dora): replace the paragraph with "This usually takes a minute or two. If you came from a job link, go back to it: it unlocks the proof upload as soon as your ID is verified. If you joined from an invitation, you're all set: we'll email you job offers."

- [ ] **Step 4: Push and open the PR into `claude/zealous-newton-ld8eog`**

```bash
git push -u origin claude/sales-growth-ff6d5d
gh pr create --base claude/zealous-newton-ld8eog --title "Sales and Recruiter: guarded marketing and worker-pool growth (services/growth)" --body-file <scratchpad>/pr-body.md
```

Then bind the PR in the app (`get_status`, `bind_pr` if needed) and read its checks. Do not merge.

- [ ] **Step 5: Report**

Write the hand-over note to the shared notes folder (`sales-recruiter.md`) and send the final report to the "Operis hackathon coordinator" session: the PR link first, then each claim labelled VERIFIED, INFERRED or NOT RUN.
