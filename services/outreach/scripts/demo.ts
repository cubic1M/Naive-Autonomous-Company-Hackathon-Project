/**
 * End-to-end demo of the outreach flow: find_people → send_blast → show the emails.
 *
 *   npx tsx scripts/demo.ts                          # FREE: uses saved sample data, sends nothing
 *   LIVE_SEARCH=1 npx tsx scripts/demo.ts            # real Monid search (~$0.10 max), still sends nothing
 *   TEST_EMAIL=you@x.com npx tsx scripts/demo.ts     # also adds YOU as a nearby regular, so you see your own invite
 *   TEST_EMAIL=you@x.com SEND=1 NAIVE_API_KEY=... NAIVE_OPS_IDENTITY_ID=... NAIVE_OPS_INBOX_ID=... npx tsx scripts/demo.ts
 *                                                    # really emails ONLY you (allowlist); businesses are never emailed
 *
 * Job options: JOB_TITLE, JOB_ADDRESS, JOB_LAT, JOB_LNG, JOB_BUDGET, JOB_CERT, JOB_REMOTE=1 (online work, no distance limit).
 * Hints (comma lists): HINT_ROLES, HINT_SKILLS, HINT_CREDENTIAL, e.g.
 *   JOB_REMOTE=1 JOB_TITLE="Review our SaaS terms" HINT_ROLES="contract attorney,paralegal" HINT_CREDENTIAL="California bar license" npx tsx scripts/demo.ts
 */
import { sendBlastDetailed } from '../src/blast.js';
import { DEFAULTS, type Env } from '../src/env.js';
import { findPeopleDetailed } from '../src/find.js';
import { HttpMonid, type Monid } from '../src/monid.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import { MonidEmailSender, NaiveEmailSender, RecordingSender, type EmailSender } from '../src/senders.js';
import { FakeMonid } from '../test/helpers/fakeMonid.js';

const e = process.env;
const liveSearch = e.LIVE_SEARCH === '1';
const send = e.SEND === '1';
const testEmail = e.TEST_EMAIL?.trim().toLowerCase();
const monidKey = e.MONID_API_KEY;

if (liveSearch && !monidKey) {
  console.error('LIVE_SEARCH=1 needs MONID_API_KEY. Run without LIVE_SEARCH for the free demo.');
  process.exit(1);
}
const agentmailInbox = e.AGENTMAIL_INBOX; // e.g. operis-ops@agentmail.to (sent through Monid)
const naiveReady = Boolean(e.NAIVE_API_KEY && e.NAIVE_OPS_IDENTITY_ID && e.NAIVE_OPS_INBOX_ID);
if (send && (!testEmail || !(naiveReady || (agentmailInbox && monidKey)))) {
  console.error('SEND=1 needs TEST_EMAIL and either AGENTMAIL_INBOX + MONID_API_KEY, or NAIVE_API_KEY + NAIVE_OPS_IDENTITY_ID + NAIVE_OPS_INBOX_ID.');
  process.exit(1);
}

const env: Env = {
  MONID_API_KEY: monidKey ?? 'demo',
  MONID_BASE_URL: e.MONID_BASE_URL || DEFAULTS.MONID_BASE_URL,
  PUBLIC_BASE_URL: e.PUBLIC_BASE_URL || 'http://localhost:3000',
  LINK_SIGNING_SECRET: 'demo-secret',
  NAIVE_API_KEY: e.NAIVE_API_KEY,
  NAIVE_BASE_URL: e.NAIVE_BASE_URL || DEFAULTS.NAIVE_BASE_URL,
  NAIVE_OPS_IDENTITY_ID: e.NAIVE_OPS_IDENTITY_ID,
  NAIVE_OPS_INBOX_ID: e.NAIVE_OPS_INBOX_ID,
  OUTREACH_MAX_SPEND_USD: Number(e.MAX_SPEND ?? 0.1),
  OUTREACH_RADIUS_KM: DEFAULTS.OUTREACH_RADIUS_KM,
  OUTREACH_LIVE: false, // never email scraped businesses from a demo
  OUTREACH_TEST_ALLOWLIST: testEmail ? [testEmail] : [],
  PAUSE_OUTREACH: false,
  OUTREACH_MANUAL_DAILY_CAP: 20,
  OUTREACH_MANUAL_QUEUE: e.MANUAL_QUEUE === '1',
};

const list = (v: string | undefined) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const hints = {
  ...(list(e.HINT_ROLES) ? { roles: list(e.HINT_ROLES) } : {}),
  ...(list(e.HINT_SKILLS) ? { skills: list(e.HINT_SKILLS) } : {}),
  ...(e.HINT_CREDENTIAL ? { credential: e.HINT_CREDENTIAL } : {}),
  ...(e.JOB_REMOTE ? { remote: e.JOB_REMOTE === '1' } : {}),
};

const lat = Number(e.JOB_LAT ?? 37.7749);
const lng = Number(e.JOB_LNG ?? -122.4194);
const repo = new InMemoryRepo();
repo.addJob({
  id: 'demo-job',
  title: e.JOB_TITLE ?? 'Hold a sign near the YC office',
  instructions: e.JOB_INSTRUCTIONS ?? 'Stand at the corner holding our sign for 2 hours, 12-2pm.',
  address: e.JOB_ADDRESS ?? 'San Francisco, CA',
  lat,
  lng,
  deadline: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  budget_usd: Number(e.JOB_BUDGET ?? 60),
  worker_pay_usd: null,
  certification_required: e.JOB_CERT ?? null,
  remote: e.JOB_REMOTE === '1',
  status: 'held',
});

if (testEmail) {
  repo.addPerson({ name: e.TEST_NAME ?? null, email: testEmail, kind: 'person', lat: lat + 0.003, lng, regular: true, source: 'regular', dedupe_key: `email:${testEmail}` });
}

/** Free mode: saved Google Maps results; each site's contact page "shows" info@<its domain>. */
function sampleMonid(): Monid {
  const fake = new FakeMonid();
  return {
    async run(provider, endpoint, input) {
      if (endpoint === '/crawl') {
        const host = new URL(String(input.body?.url)).hostname.replace(/^www\./, '');
        return { runId: 'demo', status: 'COMPLETED', httpStatus: 200, output: { results: { content: `Contact us: info@${host}` } }, cost_usd: 0.001 };
      }
      return fake.run(provider, endpoint, input);
    },
  };
}
const monid: Monid = liveSearch ? new HttpMonid(monidKey!, env.MONID_BASE_URL) : sampleMonid();
const recorder = new RecordingSender();
const email: EmailSender = !send
  ? recorder
  : naiveReady
    ? new NaiveEmailSender({ apiKey: env.NAIVE_API_KEY!, baseUrl: env.NAIVE_BASE_URL, identityId: env.NAIVE_OPS_IDENTITY_ID!, inboxId: env.NAIVE_OPS_INBOX_ID! })
    : new MonidEmailSender(new HttpMonid(monidKey!, env.MONID_BASE_URL), agentmailInbox!);

console.log(`\n== 1. find_people (${liveSearch ? 'LIVE Monid search' : 'saved sample data, free'}) ==`);
const found = await findPeopleDetailed({ job_id: 'demo-job', limit: 10, hints }, { repo, monid, env });
const pl = found.plan;
console.log(`  plan: ${pl.remote ? 'REMOTE (no distance limit)' : `on-site near ${pl.locationText ?? '?'}`}; roles=${pl.roles.join('|')}; skills=${pl.skills.join('|') || '-'}; credential=${pl.credential ?? '-'}`);
for (const c of found.output.candidates) {
  console.log(`  ${c.score.toFixed(2)}  ${String(c.distance_km ?? '-').padStart(4)} km  ${c.channel.padEnd(16)}  ${c.source.padEnd(15)}  ${c.name ?? '(no name)'}`);
}
if (found.output.candidates.length === 0) console.log('  (no contactable candidates found)');
console.log(`  spend: $${found.spend_usd.toFixed(4)}${liveSearch ? '' : ' (simulated, nothing charged)'}`);

console.log(`\n== 2. send_blast (${send ? `REAL email to ${testEmail} only` : 'dry run, nothing sent'}) ==`);
const ids = found.output.candidates.map((c) => c.candidate_id);
if (ids.length) {
  const blast = await sendBlastDetailed({ job_id: 'demo-job', candidate_ids: ids }, { repo, env, email });
  const toYou = send ? `really emailed you: ${blast.sent}` : `to you (would really send with SEND=1): ${blast.sent}`;
  console.log(`  ${toYou}   businesses (dry run, not sent): ${blast.dry_run}   failed: ${blast.failed}   skipped (opted out): ${blast.skipped_opted_out}`);
}

const queue = await repo.listManualTasks({ job_id: 'demo-job', status: 'queued' });
console.log(`\n== 2b. manual DM queue (${queue.length} queued for a teammate to send; nothing is auto-sent) ==`);
for (const t of queue) console.log(`  [${t.platform}] ${t.profile_url}\n    ${t.message.replace(/\n/g, '\n    ')}\n`);

console.log('\n== 3. the invite email (what each person gets) ==');
const people = await repo.getPeople(ids);
const { renderEmail, workerPay } = await import('../src/templates.js');
const job = (await repo.getJob('demo-job'))!;
const sample = people.find((p) => p.kind === 'business') ?? people[0];
if (sample) {
  const msg = renderEmail({ job, person: sample, link: `${env.PUBLIC_BASE_URL}/j/<signed-token>`, payUsd: workerPay(job) });
  console.log(`  To: ${sample.email}\n  Subject: ${msg.subject}\n`);
  console.log(msg.text.split('\n').map((l) => `  | ${l}`).join('\n'));
}
console.log('\nDone. Businesses are never emailed by this script.\n');
