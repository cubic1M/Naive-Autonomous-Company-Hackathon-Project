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
    GROWTH_REDDIT_DAILY_USD: 0.25,
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
