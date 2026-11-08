/** Real, free search against the local talent pool (data/pool.json): pool stats + 3 demo jobs. npx tsx scripts/pool-search.ts */
import { readFileSync } from 'node:fs';
import { InMemoryRepo } from '../src/repo/memory.js';
import { findPeopleDetailed } from '../src/find.js';
import { DEFAULTS } from '../src/env.js';
const pool = InMemoryRepo.fromSnapshot(JSON.parse(readFileSync('/home/user/Naive-Autonomous-Company-Hackathon-Project/services/outreach/data/pool.json','utf8')));
const people = [...pool.people.values()];
const bySource: Record<string, number> = {};
for (const p of people) { const s = (p.source ?? '?').replace(/^monid:/,'').split('/')[0]+'/'+((p.source??'').split('/').slice(1).join('/')); bySource[s] = (bySource[s]??0)+1; }
console.log(JSON.stringify({ pool_total: people.length, with_email: people.filter(p=>p.email).length, bySource }, null, 0));
const monid = { async run() { throw new Error('offline: pool only'); } };
const env = { MONID_API_KEY:'x', MONID_BASE_URL:DEFAULTS.MONID_BASE_URL, PUBLIC_BASE_URL:'https://operis.live', LINK_SIGNING_SECRET:'x', NAIVE_BASE_URL:DEFAULTS.NAIVE_BASE_URL, OUTREACH_MAX_SPEND_USD:0.5, OUTREACH_RADIUS_KM:8, OUTREACH_LIVE:false, OUTREACH_TEST_ALLOWLIST:[], PAUSE_OUTREACH:false, OUTREACH_MANUAL_DAILY_CAP:20, OUTREACH_MANUAL_QUEUE:false, OUTREACH_TIME_BUDGET_MS:30000, OUTREACH_CALL_TIMEOUT_MS:10000, OUTREACH_ENRICH_CONCURRENCY:16 } as any;
for (const [title, hints, remote] of [
  ['Fix our Next.js deploy bug', { roles:['Next.js developer','React developer','full stack developer'], skills:['Next.js','React','TypeScript'], remote:true }, true],
  ['Review our SaaS terms of service', { roles:['contract attorney','technology attorney'], skills:['SaaS','terms of service'], credential:'attorney', remote:true }, true],
  ['Photograph the YC sign', { roles:['photographer','event photographer'], remote:false }, false],
] as const) {
  const id = 'j-'+title.length; pool.addJob({ id, title, instructions:title, address: remote? null : '560 20th St, San Francisco, CA', lat: remote? null:37.7609, lng: remote? null:-122.3875, deadline:null, budget_usd:100, worker_pay_usd:null, certification_required:null, remote, status:'held' } as any);
  const t=Date.now(); const r = await findPeopleDetailed({ job_id:id, limit:40, hints: hints as any }, { repo: pool, monid: monid as any, env });
  console.log(JSON.stringify({ title, elapsed_ms: Date.now()-t, returned: r.output.candidates.length, from_pool: (r as any).from_pool, top: r.output.candidates.slice(0,6).map(c=>({ n: (c.name??'').split(' ').map(w=>w[0]).join('').slice(0,3), s:c.score, src:c.source, d:c.distance_km })) }));
}
