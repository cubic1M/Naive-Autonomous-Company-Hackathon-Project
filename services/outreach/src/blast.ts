import { randomBytes } from 'node:crypto';
import { pickChannel } from './channel.js';
import type { Env } from './env.js';
import type { Repo } from './repo.js';
import type { EmailSender, SendResult, SmsSender } from './senders.js';
import { renderEmail, renderSms, workerPay } from './templates.js';
import { jobLink, signJobToken } from './tokens.js';
import type { Channel, OutreachStatus, SendBlastInput, SendBlastOutput } from './types.js';

export const MAX_BLAST = 50;
const CONCURRENCY = 5;

export interface BlastDeps {
  repo: Repo;
  env: Env;
  email: EmailSender;
  sms?: SmsSender;
  now?: () => Date;
}

export interface BlastPersonResult {
  person_id: string;
  channel: Channel | null;
  status: OutreachStatus | 'skipped_opted_out' | 'skipped_unknown' | 'skipped_no_channel' | 'skipped_already_contacted' | 'paused';
  reason?: string;
  outreach_id?: string;
}

export interface SendBlastDetailed extends SendBlastOutput {
  dry_run: number;
  failed: number;
  results: BlastPersonResult[];
}

export async function sendBlast(input: SendBlastInput, deps: BlastDeps): Promise<SendBlastOutput> {
  const { sent, skipped_opted_out, outreach_ids } = await sendBlastDetailed(input, deps);
  return { sent, skipped_opted_out, outreach_ids };
}

export async function sendBlastDetailed(input: SendBlastInput, deps: BlastDeps): Promise<SendBlastDetailed> {
  const { repo, env } = deps;
  const now = deps.now ?? (() => new Date());
  const out: SendBlastDetailed = { sent: 0, skipped_opted_out: 0, outreach_ids: [], dry_run: 0, failed: 0, results: [] };

  if (env.PAUSE_OUTREACH) return out;

  const job = await repo.getJob(input.job_id);
  if (!job) throw new Error(`send_blast: job ${input.job_id} not found`);
  if (job.status !== 'held' && job.status !== 'outreach') {
    throw new Error(`send_blast: job ${job.id} has status '${job.status}'; expected 'held' or 'outreach'`);
  }

  const ids = [...new Set(input.candidate_ids)].slice(0, MAX_BLAST);
  const people = new Map((await repo.getPeople(ids)).map((p) => [p.id, p]));
  const already = new Set((await repo.listOutreachForJob(job.id)).map((o) => o.worker_id));
  const allow = new Set(env.OUTREACH_TEST_ALLOWLIST.map((s) => s.toLowerCase()));

  const results = new Array<BlastPersonResult>(ids.length);

  const work = async (idx: number): Promise<void> => {
    const id = ids[idx]!;
    const person = people.get(id);
    if (!person) {
      results[idx] = { person_id: id, channel: null, status: 'skipped_unknown', reason: 'unknown candidate' };
      return;
    }
    if (person.opted_out) {
      results[idx] = { person_id: id, channel: null, status: 'skipped_opted_out' };
      return;
    }
    if (already.has(id)) {
      results[idx] = { person_id: id, channel: null, status: 'skipped_already_contacted', reason: 'already has outreach for this job' };
      return;
    }
    let channel = pickChannel(person);
    if (channel === null) {
      results[idx] = { person_id: id, channel: null, status: 'skipped_no_channel', reason: 'no contactable channel' };
      return;
    }
    if (channel === 'sms' && !deps.sms) {
      if (person.email) channel = 'email';
      else {
        results[idx] = { person_id: id, channel: 'sms', status: 'skipped_no_channel', reason: 'sms sender unavailable and no email' };
        return;
      }
    }
    const to = channel === 'sms' ? person.phone! : person.email!;
    const live = env.OUTREACH_LIVE || allow.has(to.toLowerCase());

    const nonce = randomBytes(9).toString('base64url');
    const token = signJobToken({ job_id: job.id, worker_id: person.id, outreach_nonce: nonce }, env.LINK_SIGNING_SECRET, undefined, now());
    const link = jobLink(env.PUBLIC_BASE_URL, token);
    const ctx = { job, person, link, payUsd: workerPay(job) };

    let status: OutreachStatus;
    let reason: string | undefined;
    let res: SendResult | undefined;
    if (!live) {
      status = 'dry_run';
    } else {
      try {
        if (channel === 'sms') res = await deps.sms!.send(to, renderSms(ctx));
        else {
          const m = renderEmail(ctx);
          res = await deps.email.send(to, m.subject, m.text);
        }
      } catch (e) {
        res = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      status = res.ok ? 'sent' : 'failed';
      if (!res.ok) reason = res.error ?? 'send failed';
    }

    try {
      const row = await repo.insertOutreach({ job_id: job.id, worker_id: person.id, channel, token, status });
      results[idx] = { person_id: id, channel, status, reason, outreach_id: row.id };
      if (status === 'sent') {
        await repo.touchContacted(person.id, now());
        if (channel === 'sms' && res?.cost_usd) await repo.recordCost(job.id, 'sms_cost', res.cost_usd, res.ref ?? row.id);
      }
    } catch (e) {
      results[idx] = { person_id: id, channel, status: 'failed', reason: `persist failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  };

  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
    while (next < ids.length) {
      const idx = next++;
      try {
        await work(idx);
      } catch (e) {
        results[idx] = { person_id: ids[idx]!, channel: null, status: 'failed', reason: e instanceof Error ? e.message : String(e) };
      }
    }
  });
  await Promise.all(workers);

  for (const r of results) {
    out.results.push(r);
    if (r.status === 'skipped_opted_out') out.skipped_opted_out++;
    else if (r.status === 'sent') out.sent++;
    else if (r.status === 'dry_run') out.dry_run++;
    else if (r.status === 'failed') out.failed++;
    if (r.outreach_id && (r.status === 'sent' || r.status === 'dry_run')) out.outreach_ids.push(r.outreach_id);
  }
  return out;
}
