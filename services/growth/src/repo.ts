import type { Contact, ContactKind, Grant, JobRow, JobWithCustomer, LogEntry, MessageKind, NewContact, RedditCall, VerificationRow } from './types.js';
import type { NewSocialPost, SocialPlatform, SocialPost, SocialPostOutcome } from './types.js';

/**
 * Persistence for growth. Writes only the growth_* tables (migrations/0001_growth.sql, 0002_social.sql); reads jobs and customers
 * (Edwin's) and worker_verifications (Cameron's). Pool rows (workers, worker_profiles) are written through
 * services/outreach's Repo, never here. MemoryGrowthRepo (tests, dry run) and PostgresGrowthRepo implement it.
 */
export interface GrowthRepo {
  /**
   * Insert or merge on (kind, email). Never clears opted_out, joined_at or last_contacted_at; fills empty fields.
   * A new row for an address that is opted out anywhere starts opted out.
   */
  upsertContact(c: NewContact): Promise<{ contact: Contact; created: boolean }>;
  getContact(id: string): Promise<Contact | null>;
  getRecruitByWorker(workerId: string): Promise<Contact | null>;
  /** Prospects not opted out and not sent to since `notSentSince`, oldest first. */
  listProspects(q: { limit: number; notSentSince: Date }): Promise<Contact[]>;
  listRecruits(): Promise<Contact[]>;
  markContacted(id: string, at: Date): Promise<void>;
  markJoined(id: string, at: Date): Promise<void>;
  /** Opt out every contact with this address; with none, store a suppression row. Returns the contacts matched. */
  optOutEmail(email: string, at: Date): Promise<number>;
  isSuppressed(email: string): Promise<boolean>;
  /** Latest real send to this address among contacts of this kind. */
  lastSentAt(email: string, kind: ContactKind): Promise<Date | null>;

  log(e: LogEntry): Promise<void>;
  messageCountsSince(kind: MessageKind, since: Date): Promise<{ sent: number; dry_run: number }>;
  /** recruit_search's Monid spend: growth_log kind 'search', without reddit_research's rows. */
  searchSpendSince(since: Date): Promise<number>;
  /** One reddit_research call, as a growth_log 'search' row with ref REDDIT_REF (redditLogEntry): no migration needed. */
  logRedditCall(c: RedditCall): Promise<void>;
  /** reddit_research's Monid spend only: its own budget, never recruit_search's. */
  redditSpendSince(since: Date): Promise<number>;

  getGrantByKey(key: string): Promise<Grant | null>;
  getGrantByJob(jobId: string): Promise<Grant | null>;
  countGrants(): Promise<number>;
  listGrants(): Promise<Grant[]>;
  /** Null when the key already has a grant. */
  insertGrant(g: { contact_id: string; grant_key: string; cap_cents: number; expires_at: Date }): Promise<Grant | null>;
  /** Set the redeemed job unless one is set already; returns the grant as stored afterwards (null if unknown). */
  reserveGrant(grantId: string, jobId: string, refundCents: number, at: Date): Promise<Grant | null>;

  listJobsSince(since: Date): Promise<JobRow[]>;
  listPaidJobs(): Promise<JobWithCustomer[]>;
  getJobWithCustomer(jobId: string): Promise<JobWithCustomer | null>;
  countPaidJobsBefore(customerId: string, before: Date, excludeJobId: string): Promise<number>;
  /** Empty when the table does not exist yet. */
  listVerifications(workerIds: string[]): Promise<VerificationRow[]>;

  /** Record one post_social attempt (growth_social_posts, migrations/0002_social.sql); returns its id. */
  logSocialPost(p: NewSocialPost): Promise<string>;
  /** Record how a pending attempt ended. Rows no longer pending are left as they are. */
  settleSocialPost(id: string, outcome: SocialPostOutcome): Promise<void>;
  /** This platform's attempts since `since`, newest first. */
  socialPostsSince(platform: SocialPlatform, since: Date): Promise<SocialPost[]>;
}

export class GrowthTablesMissing extends Error {
  constructor(migration = '0001_growth.sql') {
    super(`growth tables missing: run services/growth/migrations/${migration}`);
    this.name = 'GrowthTablesMissing';
  }
}

export const contactKindFor = (kind: MessageKind): ContactKind => (kind === 'marketing' ? 'prospect' : 'recruit');

/** growth_log.ref of reddit_research's rows: they share kind 'search' with recruit_search, never its budget. */
export const REDDIT_REF = 'reddit_research';

/** The growth_log row for one reddit_research call; what was asked, the Monid run and any error go in reason. */
export function redditLogEntry(c: RedditCall): LogEntry {
  const what = `${c.op} r/${c.subreddit}${c.query ? ` "${c.query}"` : ''} via ${c.endpoint}${c.run_id ? ` (run ${c.run_id})` : ''}`;
  return { kind: 'search', status: c.status, cost_usd: c.cost_usd, ref: REDDIT_REF, reason: (c.reason ? `${what}: ${c.reason}` : what).slice(0, 300) };
}
