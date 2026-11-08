import { randomUUID } from 'node:crypto';
import { REDDIT_REF, redditLogEntry, type GrowthRepo } from '../repo.js';
import type { Contact, ContactKind, Grant, JobRow, JobWithCustomer, LogEntry, MessageKind, NewContact, RedditCall, VerificationRow } from '../types.js';
import type { NewSocialPost, SocialPlatform, SocialPost, SocialPostOutcome } from '../types.js';

type StoredJob = JobRow & { customer_id: string | null; budget_usd: number };

/** In-memory GrowthRepo (tests, scripts/dry-run.ts). Seed jobs, customers and verifications through the arrays. */
export class MemoryGrowthRepo implements GrowthRepo {
  readonly contacts: Contact[] = [];
  readonly logs: (LogEntry & { created_at: Date })[] = [];
  readonly grants: Grant[] = [];
  readonly jobs: StoredJob[] = [];
  readonly customers: { id: string; name: string | null; contact_email: string | null }[] = [];
  readonly verifications: VerificationRow[] = [];
  readonly socialPosts: SocialPost[] = [];

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
    return this.spend((l) => l.ref !== REDDIT_REF, since);
  }

  async logRedditCall(c: RedditCall): Promise<void> {
    await this.log(redditLogEntry(c));
  }

  async redditSpendSince(since: Date): Promise<number> {
    return this.spend((l) => l.ref === REDDIT_REF, since);
  }

  private spend(which: (l: LogEntry) => boolean, since: Date): number {
    return this.logs.filter((l) => l.kind === 'search' && which(l) && l.created_at >= since).reduce((sum, l) => sum + (l.cost_usd ?? 0), 0);
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

  async logSocialPost(p: NewSocialPost): Promise<string> {
    const row: SocialPost = {
      id: this.newId(),
      platform: p.platform,
      status: p.status,
      reason: p.reason ?? null,
      body: p.body,
      body_hash: p.body_hash,
      provider: null,
      provider_post_id: null,
      url: null,
      created_at: this.clock(),
    };
    this.socialPosts.push(row);
    return row.id;
  }

  async settleSocialPost(id: string, o: SocialPostOutcome): Promise<void> {
    const row = this.socialPosts.find((p) => p.id === id && p.status === 'pending');
    if (row) Object.assign(row, { status: o.status, reason: o.reason ?? null, provider: o.provider ?? null, provider_post_id: o.provider_post_id ?? null, url: o.url ?? null });
  }

  async socialPostsSince(platform: SocialPlatform, since: Date): Promise<SocialPost[]> {
    return this.socialPosts
      .filter((p) => p.platform === platform && p.created_at >= since)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .map((p) => ({ ...p }));
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
