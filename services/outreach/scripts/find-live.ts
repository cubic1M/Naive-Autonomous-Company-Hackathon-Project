/** REAL run (costs money, capped at $0.10): MONID_API_KEY=... npx tsx scripts/find-live.ts */
import { DEFAULTS, type Env } from '../src/env.js';
import { findPeopleDetailed } from '../src/find.js';
import { HttpMonid } from '../src/monid.js';
import { InMemoryRepo } from '../src/repo/memory.js';

const key = process.env.MONID_API_KEY;
if (!key) {
  console.error('MONID_API_KEY is required');
  process.exit(1);
}

const env: Env = {
  MONID_API_KEY: key,
  MONID_BASE_URL: process.env.MONID_BASE_URL || DEFAULTS.MONID_BASE_URL,
  PUBLIC_BASE_URL: 'http://localhost:3000',
  LINK_SIGNING_SECRET: 'local-dev',
  NAIVE_BASE_URL: DEFAULTS.NAIVE_BASE_URL,
  OUTREACH_MAX_SPEND_USD: 0.1,
  OUTREACH_RADIUS_KM: DEFAULTS.OUTREACH_RADIUS_KM,
  OUTREACH_LIVE: false,
  OUTREACH_TEST_ALLOWLIST: [],
  PAUSE_OUTREACH: true,
};

const repo = new InMemoryRepo();
repo.addJob({
  id: 'job-live-1',
  title: 'Hold a sign near the YC office',
  instructions: 'Stand outside the YC office holding a sign for 2 hours.',
  address: '335 Pioneer Way, Mountain View, CA',
  lat: 37.7749,
  lng: -122.4194,
  deadline: null,
  budget_usd: 60,
  worker_pay_usd: null,
  certification_required: null,
  status: 'requested',
});

const monid = new HttpMonid(env.MONID_API_KEY, env.MONID_BASE_URL);
const res = await findPeopleDetailed({ job_id: 'job-live-1', limit: 10 }, { repo, monid, env });
console.log('candidates:', JSON.stringify(res.output.candidates, null, 2));
console.log('runs:', JSON.stringify(res.runs, null, 2));
console.log('spend_usd:', res.spend_usd);
