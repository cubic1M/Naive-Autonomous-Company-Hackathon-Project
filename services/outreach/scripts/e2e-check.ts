/**
 * Backend end-to-end check for one job, without emailing scraped people:
 *  1. find_people for the job (talent pool first, then a live Monid search within the spend cap)
 *  2. check every candidate email is sendable (valid format + the domain has MX records)
 *  3. send_blast in DEMO MODE: only TEST_EMAIL really receives the invite (AgentMail); everyone else is a dry run
 *
 *   MONID_API_KEY=... AGENTMAIL_INBOX=ops@mail.operis.live TEST_EMAIL=laz.andrewli@gmail.com \
 *     POOL_FILE=data/pool.json npx tsx scripts/e2e-check.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { sendBlastDetailed } from '../src/blast.js';
import { DEFAULTS, type Env } from '../src/env.js';
import { findPeopleDetailed } from '../src/find.js';
import { HttpMonid } from '../src/monid.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import { MonidEmailSender } from '../src/senders.js';

const e = process.env;
const key = e.MONID_API_KEY!;
const inbox = e.AGENTMAIL_INBOX!;
const testEmail = (e.TEST_EMAIL ?? '').toLowerCase();
if (!key || !inbox || !testEmail) throw new Error('MONID_API_KEY, AGENTMAIL_INBOX and TEST_EMAIL are required');

const env: Env = {
  MONID_API_KEY: key,
  MONID_BASE_URL: DEFAULTS.MONID_BASE_URL,
  PUBLIC_BASE_URL: 'https://operis.live',
  LINK_SIGNING_SECRET: 'e2e-check',
  NAIVE_BASE_URL: DEFAULTS.NAIVE_BASE_URL,
  OUTREACH_MAX_SPEND_USD: Number(e.MAX_SPEND ?? 0.5),
  OUTREACH_RADIUS_KM: 8,
  OUTREACH_LIVE: false, // never email scraped people from a test
  OUTREACH_TEST_ALLOWLIST: [testEmail],
  PAUSE_OUTREACH: false,
  OUTREACH_MANUAL_DAILY_CAP: 20,
  OUTREACH_MANUAL_QUEUE: false,
  OUTREACH_TIME_BUDGET_MS: 60000,
  OUTREACH_CALL_TIMEOUT_MS: 15000,
  OUTREACH_ENRICH_CONCURRENCY: 16,
};

const poolFile = e.POOL_FILE ?? 'data/pool.json';
const repo = existsSync(poolFile) ? InMemoryRepo.fromSnapshot(JSON.parse(readFileSync(poolFile, 'utf8'))) : new InMemoryRepo();
console.log(`pool: ${repo.people.size} people`);

// The tester joins as a nearby regular (what seed-team.ts does on the real database).
repo.addPerson({
  name: 'Andrew Li', email: testEmail, kind: 'person', lat: 37.7609, lng: -122.3875, regular: true, source: 'seed:team',
  categories: ['Next.js', 'TypeScript', 'React', 'Vercel'], snippet: 'Full-stack TypeScript / React / Next.js developer',
  dedupe_key: `email:${testEmail}`,
});

repo.addJob({
  id: e.JOB_ID ?? 'e2e-job',
  title: 'Fix our Next.js deploy bug at the YC office',
  instructions: 'Our Vercel deploy fails on main. Come to the YC office, fix it with our team, and link the PR.',
  address: '560 20th St, San Francisco, CA', lat: 37.7609, lng: -122.3875,
  deadline: new Date(Date.now() + 20 * 3600e3).toISOString(), budget_usd: 100, worker_pay_usd: 75,
  certification_required: null, remote: false, status: 'held',
});
const jobId = e.JOB_ID ?? 'e2e-job';

const hints = { roles: ['Next.js developer', 'TypeScript developer', 'full stack developer'], skills: ['Next.js', 'TypeScript', 'Vercel'], remote: false };
const t = Date.now();
const found = await findPeopleDetailed({ job_id: jobId, limit: 40, hints }, { repo, monid: new HttpMonid(key), env });
console.log(`\n== 1. find_people: ${found.output.candidates.length} candidates in ${((Date.now() - t) / 1000).toFixed(1)}s, spend $${found.spend_usd.toFixed(3)}`);
for (const r of found.runs) console.log(`   source ${r.source.replace('monid:', '').padEnd(36)} leads ${String(r.leads).padStart(3)}  $${r.cost_usd.toFixed(4)}${r.error ? `  (${r.error.slice(0, 60)})` : ''}`);

const people = await repo.getPeople(found.output.candidates.map((c) => c.candidate_id));
const mask = (em: string) => em.replace(/^(.).*(@.*)$/, '$1***$2');
const mxCache = new Map<string, boolean>();
async function hasMx(domain: string): Promise<boolean> {
  // DNS-over-HTTPS (the sandbox resolver may block MX lookups): Answer type 15 = MX.
  if (!mxCache.has(domain)) mxCache.set(domain, await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`).then((r) => r.json()).then((d: { Answer?: { type: number }[] }) => (d.Answer ?? []).some((a) => a.type === 15)).catch(() => false));
  return mxCache.get(domain)!;
}
console.log('\n== 2. sendability (format + MX)');
let sendable = 0;
for (const [i, p] of people.entries()) {
  const em = p.email ?? '';
  const okFormat = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(em);
  const okMx = okFormat ? await hasMx(em.split('@')[1]!) : false;
  if (okFormat && okMx) sendable++;
  const c = found.output.candidates[i]!;
  console.log(`   ${String(i + 1).padStart(2)}. ${c.score.toFixed(2)}  ${(c.source).padEnd(16)} ${(p.headline ?? p.snippet ?? '').slice(0, 40).padEnd(40)} ${em === testEmail ? em : mask(em)}  ${okFormat && okMx ? 'sendable ✓' : `NOT sendable (${okFormat ? 'no MX' : 'bad format'})`}`);
}
console.log(`   => ${sendable}/${people.length} sendable`);

if (e.SKIP_SEND === '1') { console.log('\n== 3. send_blast skipped (SKIP_SEND=1)'); process.exit(0); }
console.log('\n== 3. send_blast (demo mode: only the tester really gets it)');
const blast = await sendBlastDetailed(
  { job_id: jobId, candidate_ids: found.output.candidates.map((c) => c.candidate_id) },
  { repo, env, email: new MonidEmailSender(new HttpMonid(key), inbox) },
);
console.log(`   really sent: ${blast.sent} (to ${testEmail})   dry run (not sent): ${blast.dry_run}   failed: ${blast.failed}   opted out: ${blast.skipped_opted_out}`);
for (const r of blast.results.filter((x) => x.status === 'failed')) console.log(`   failed: ${r.person_id} ${r.reason ?? ''}`);
