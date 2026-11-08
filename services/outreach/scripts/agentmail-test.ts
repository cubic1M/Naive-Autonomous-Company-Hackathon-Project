/**
 * Send one real test invite through AgentMail (via Monid), exactly as send_blast would.
 *   MONID_API_KEY=... AGENTMAIL_INBOX=ops@mail.operis.live npx tsx scripts/agentmail-test.ts azli@stanford.edu
 */
import { HttpMonid } from '../src/monid.js';
import { MonidEmailSender } from '../src/senders.js';
import { renderEmail } from '../src/templates.js';
import type { JobForOutreach, Person } from '../src/types.js';

const to = process.argv[2];
const key = process.env.MONID_API_KEY;
const inbox = process.env.AGENTMAIL_INBOX;
if (!to || !key || !inbox) {
  console.error('Usage: MONID_API_KEY=... AGENTMAIL_INBOX=ops@mail.operis.live npx tsx scripts/agentmail-test.ts you@example.com');
  process.exit(1);
}

const job: JobForOutreach = {
  id: 'test', title: 'Fix our Next.js deploy bug at the YC office', instructions: 'Hackathon team needs a TypeScript/Next.js developer in person.',
  address: 'Y Combinator, San Francisco, CA', lat: 37.7749, lng: -122.4194, deadline: new Date(Date.now() + 6 * 3600e3).toISOString(),
  budget_usd: 100, worker_pay_usd: 75, certification_required: null, remote: false, status: 'held',
};
const person: Person = {
  id: 'test', name: 'Andrew Li', email: to, phone: null, source: 'seed:team', opted_out: false, kind: 'person', website: null, profile_url: null,
  address: null, lat: null, lng: null, categories: [], rating: null, snippet: null, regular: true, sms_consent: false, last_contacted_at: null,
  dedupe_key: 'test', profiles: [], headline: 'Full-stack TypeScript developer', location_text: 'San Francisco, CA', credentials: [],
  open_to_work: true, last_active_at: null,
};
const msg = renderEmail({ job, person, link: `${process.env.PUBLIC_BASE_URL ?? 'https://operis.live'}/j/TESTlink00-xxxxxxxx`, payUsd: 75 });
const r = await new MonidEmailSender(new HttpMonid(key), inbox).send(to, `[TEST] ${msg.subject}`, msg.text, msg.html);
console.log(r.ok ? `Sent from ${inbox} to ${to} (${r.ref}), cost $${r.cost_usd ?? 0}` : `FAILED: ${r.error}`);
process.exit(r.ok ? 0 : 1);
