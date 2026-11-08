/**
 * Build the talent pool ahead of a demo: runs find_people for a list of job families and saves every person found.
 *
 *   MONID_API_KEY=... npx tsx scripts/warm-pool.ts                      # all families (spends Monid credits)
 *   MONID_API_KEY=... npx tsx scripts/warm-pool.ts --families legal,react
 *   npx tsx scripts/warm-pool.ts --dry                                  # print the plan, call nothing
 *
 * Env: MAX_SPEND (USD per family, default 0.5), POOL_FILE (default data/pool.json),
 *      DATABASE_URL (save into Postgres instead of the JSON file), TIME_BUDGET_MS (default 240000).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULTS, type Env } from '../src/env.js';
import { findPeopleDetailed } from '../src/find.js';
import { HttpMonid } from '../src/monid.js';
import type { Repo } from '../src/repo.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import type { Lead, Person, SearchHints } from '../src/types.js';

interface Family {
  key: string;
  title: string;
  instructions: string;
  remote: boolean;
  hints: SearchHints;
}

const SF = { lat: 37.7749, lng: -122.4194, address: 'San Francisco, CA' };

export const FAMILIES: Family[] = [
  { key: 'legal', title: 'Review our SaaS terms of service', instructions: 'Online contract review for a SaaS product.', remote: true, hints: { roles: ['contract attorney', 'paralegal'], skills: ['SaaS', 'terms of service', 'privacy'], credential: 'California bar license' } },
  { key: 'react', title: 'Build a React and TypeScript feature', instructions: 'Small frontend feature in an existing codebase.', remote: true, hints: { roles: ['React developer', 'TypeScript developer'], skills: ['React', 'TypeScript', 'Next.js'] } },
  { key: 'design', title: 'Design a logo and brand kit', instructions: 'Logo and basic brand identity.', remote: true, hints: { roles: ['logo designer', 'brand designer', 'graphic designer'], skills: ['logo', 'branding', 'Figma'] } },
  { key: 'copy', title: 'Write website copywriting', instructions: 'Landing page and blog copy.', remote: true, hints: { roles: ['copywriter', 'content writer'], skills: ['copywriting', 'blog'] } },
  { key: 'translate', title: 'Translate documents into Spanish', instructions: 'English to Spanish translation.', remote: true, hints: { roles: ['Spanish translator'], skills: ['Spanish', 'translation'] } },
  { key: 'bookkeeping', title: 'Bookkeeping cleanup', instructions: 'Reconcile accounts in QuickBooks.', remote: true, hints: { roles: ['bookkeeper', 'accountant'], skills: ['QuickBooks', 'bookkeeping'] } },
  { key: 'data', title: 'Data analysis and dashboards', instructions: 'Clean a dataset and build a dashboard.', remote: true, hints: { roles: ['data analyst'], skills: ['SQL', 'Excel', 'dashboards'] } },
  { key: 'video', title: 'Edit a promo video', instructions: 'Cut and polish a 60 second promo video.', remote: true, hints: { roles: ['video editor'], skills: ['Premiere', 'video editing'] } },
  { key: 'ambassador', title: 'Hold a sign and hand out flyers', instructions: 'Stand at a busy corner for 2 hours holding our sign.', remote: false, hints: { roles: ['brand ambassador', 'sign holder', 'street team member'] } },
  { key: 'photo', title: 'Event photographer needed', instructions: 'Photograph a 2 hour event.', remote: false, hints: { roles: ['event photographer', 'photographer'] } },
  { key: 'notary', title: 'Mobile notary for a signing', instructions: 'Notarize documents on site.', remote: false, hints: { roles: ['mobile notary', 'notary public'], credential: 'notary public' } },
  { key: 'courier', title: 'Courier for a same-day delivery', instructions: 'Pick up and deliver a package.', remote: false, hints: { roles: ['courier', 'delivery driver'] } },
];

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const fi = argv.indexOf('--families');
const wanted = fi >= 0 ? (argv[fi + 1] ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
const e = process.env;
const selected = wanted ? FAMILIES.filter((f) => wanted.some((w) => f.key === w || f.key.startsWith(w))) : FAMILIES;
if (wanted && selected.length === 0) {
  console.error(`No family matches ${wanted.join(',')}. Available: ${FAMILIES.map((f) => f.key).join(', ')}`);
  process.exit(1);
}

const maxSpend = Number(e.MAX_SPEND ?? 0.5);
const timeBudget = Number(e.TIME_BUDGET_MS ?? 240000);
const limit = 50;
const poolFile = resolve(e.POOL_FILE ?? 'data/pool.json');

console.log(`warm-pool: ${selected.length} families, up to $${maxSpend} each, ${timeBudget / 1000}s budget each, limit ${limit}`);
console.log(`  target: ${e.DATABASE_URL ? 'Postgres (DATABASE_URL)' : poolFile}`);
for (const f of selected) {
  console.log(`  - ${f.key.padEnd(12)} ${f.remote ? 'remote ' : 'on-site'} roles=${f.hints.roles?.join('|')}${f.hints.skills ? ` skills=${f.hints.skills.join('|')}` : ''}${f.remote ? '' : ` near ${SF.address}`}`);
}
if (dry) {
  console.log('--dry: nothing called.');
  process.exit(0);
}

const key = e.MONID_API_KEY;
if (!key) {
  console.error('MONID_API_KEY is required (or use --dry).');
  process.exit(1);
}

const env: Env = {
  MONID_API_KEY: key,
  MONID_BASE_URL: e.MONID_BASE_URL || DEFAULTS.MONID_BASE_URL,
  PUBLIC_BASE_URL: 'http://localhost:3000',
  LINK_SIGNING_SECRET: 'warm-pool',
  NAIVE_BASE_URL: DEFAULTS.NAIVE_BASE_URL,
  OUTREACH_MAX_SPEND_USD: maxSpend,
  OUTREACH_RADIUS_KM: DEFAULTS.OUTREACH_RADIUS_KM,
  OUTREACH_LIVE: false,
  OUTREACH_TEST_ALLOWLIST: [],
  PAUSE_OUTREACH: true,
  OUTREACH_MANUAL_DAILY_CAP: 20,
  OUTREACH_MANUAL_QUEUE: false,
  OUTREACH_TIME_BUDGET_MS: timeBudget,
  OUTREACH_CALL_TIMEOUT_MS: Number(e.CALL_TIMEOUT_MS ?? 30000),
  OUTREACH_ENRICH_CONCURRENCY: Number(e.OUTREACH_ENRICH_CONCURRENCY ?? 16),
};
const monid = new HttpMonid(key, env.MONID_BASE_URL);

// Target store: Postgres, or an in-memory pool seeded from the JSON file.
let target: Repo;
let sqlEnd: (() => Promise<unknown>) | null = null;
let memTarget: InMemoryRepo | null = null;
if (e.DATABASE_URL) {
  const { default: postgres } = await import('postgres');
  const { PostgresRepo } = await import('../src/repo/postgres.js');
  const sql = postgres(e.DATABASE_URL, { max: 4, onnotice: () => {} });
  target = new PostgresRepo(sql);
  sqlEnd = () => sql.end();
} else {
  memTarget = existsSync(poolFile) ? InMemoryRepo.fromSnapshot(JSON.parse(readFileSync(poolFile, 'utf8'))) : new InMemoryRepo();
  target = memTarget;
}

const toLead = (p: Person): Lead => ({
  name: p.name, kind: p.kind, email: p.email, phone: p.phone, website: p.website, profile_url: p.profile_url, address: p.address,
  lat: p.lat, lng: p.lng, source: p.source ?? 'pool', source_ref: null, categories: p.categories, rating: p.rating, snippet: p.snippet,
  profiles: p.profiles, headline: p.headline, location_text: p.location_text, credentials: p.credentials, open_to_work: p.open_to_work,
  last_active_at: p.last_active_at,
});

let total = 0;
let totalPeople = 0;
for (const f of selected) {
  // A fresh scratch repo per family so the pool never short-circuits the live search.
  const scratch = new InMemoryRepo();
  const id = `warm-${f.key}`;
  scratch.addJob({
    id, title: f.title, instructions: f.instructions, address: f.remote ? null : SF.address, lat: f.remote ? null : SF.lat, lng: f.remote ? null : SF.lng,
    deadline: null, budget_usd: 60, worker_pay_usd: null, certification_required: f.hints.credential ?? null, remote: f.remote, status: 'held',
  });
  const t = Date.now();
  try {
    const res = await findPeopleDetailed({ job_id: id, limit, hints: { ...f.hints, remote: f.remote } }, { repo: scratch, monid, env });
    // Save everyone we found, not only the returned top N: more pool for later searches.
    let saved = 0;
    for (const p of scratch.people.values()) {
      if (!p.email && !(p.regular && p.sms_consent && p.phone)) continue;
      await target.upsertLead(toLead(p), p.dedupe_key);
      saved++;
    }
    total += res.spend_usd;
    totalPeople += saved;
    console.log(`  ${f.key.padEnd(12)} ${String(res.output.candidates.length).padStart(3)} candidates, ${String(saved).padStart(3)} emailable saved, $${res.spend_usd.toFixed(4)}, ${((Date.now() - t) / 1000).toFixed(0)}s`);
  } catch (err) {
    console.error(`  ${f.key.padEnd(12)} FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (memTarget) {
    mkdirSync(dirname(poolFile), { recursive: true });
    writeFileSync(poolFile, JSON.stringify(memTarget.toSnapshot()));
  }
}

console.log(`total spend $${total.toFixed(4)}; ${totalPeople} people saved this run${memTarget ? `; pool now ${memTarget.people.size} (${poolFile})` : ''}`);
await sqlEnd?.();
