/**
 * Send one test invite through SMTP (e.g. ops@operis.live on Microsoft 365).
 *   SMTP_HOST=smtp.office365.com SMTP_PORT=587 SMTP_USER=ops@operis.live SMTP_PASSWORD='...' \
 *     npx tsx scripts/smtp-test.ts azli@stanford.edu
 * The password stays in your shell; it is never printed.
 */
import { SmtpEmailSender, smtpConfigFromEnv } from '../src/smtp.js';
import { renderEmail } from '../src/templates.js';
import type { JobForOutreach, Person } from '../src/types.js';

const to = process.argv[2];
const cfg = smtpConfigFromEnv();
if (!to || !cfg) {
  console.error('Usage: SMTP_HOST=... SMTP_USER=... SMTP_PASSWORD=... npx tsx scripts/smtp-test.ts you@example.com');
  process.exit(1);
}

const job: JobForOutreach = {
  id: 'test', title: 'Hold a sign near the YC office', instructions: 'Hold our sign for 2 hours.', address: 'San Francisco, CA',
  lat: 37.7749, lng: -122.4194, deadline: new Date(Date.now() + 24 * 3600e3).toISOString(), budget_usd: 60, worker_pay_usd: 45,
  certification_required: null, remote: false, status: 'held',
};
const person: Person = {
  id: 'test', name: 'Andrew', email: to, phone: null, source: 'test', opted_out: false, kind: 'person', website: null, profile_url: null,
  address: null, lat: null, lng: null, categories: [], rating: null, snippet: null, regular: true, sms_consent: false, last_contacted_at: null,
  dedupe_key: 'test', profiles: [], headline: null, location_text: null, credentials: [], open_to_work: false, last_active_at: null,
};
const msg = renderEmail({ job, person, link: 'https://operis.live/j/TEST-TOKEN', payUsd: 45 });
const r = await new SmtpEmailSender(cfg).send(to, `[TEST] ${msg.subject}`, `${msg.text}\n\n---\n[TEST] Operis outreach test.`);
console.log(r.ok ? `Sent from ${cfg.user} to ${to} (${r.ref})` : `FAILED: ${r.error}`);
process.exit(r.ok ? 0 : 1);
