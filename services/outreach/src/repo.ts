import type {
  Channel,
  JobForOutreach,
  Lead,
  ManualPlatform,
  ManualTask,
  ManualTaskStatus,
  OutreachRow,
  OutreachStatus,
  Person,
} from './types.js';

export interface PoolQuery {
  terms: string[];
  credential?: string | null;
  remote: boolean;
  lat?: number | null;
  lng?: number | null;
  radiusKm?: number;
  /** On-site: the job's city, matched against location_text/address of people without coordinates. */
  locationText?: string | null;
  limit: number;
}

/** Lowercased, trimmed, de-duplicated search terms (credential included). */
export function poolTerms(q: Pick<PoolQuery, 'terms' | 'credential'>): string[] {
  const all = [...q.terms, ...(q.credential ? [q.credential] : [])].map((t) => t.toLowerCase().replace(/\s+/g, ' ').trim()).filter((t) => t.length >= 2);
  return [...new Set(all)];
}

/** First comma-separated part of a place, lowercased ("San Francisco, CA" -> "san francisco"). */
export function cityOf(locationText: string | null | undefined): string | null {
  const c = (locationText ?? '').split(',')[0]?.trim().toLowerCase();
  return c ? c : null;
}

/**
 * Persistence boundary. InMemoryRepo (tests, local dev) and PostgresRepo (prod) implement it.
 * Reads `jobs` (Edwin's table); writes `workers` (shared), `worker_profiles` (ours), `outreach` (ours),
 * and `ledger` rows of kind scrape_cost / sms_cost (Cameron's table, append-only).
 */
export interface Repo {
  getJob(id: string): Promise<JobForOutreach | null>;

  /** Regulars (regular = true, not opted out) within radiusKm of a point, nearest first. */
  listRegularsNear(lat: number, lng: number, radiusKm: number, limit: number): Promise<Person[]>;

  /**
   * Insert or update a person from a lead, keyed on dedupeKey. Never un-sets opted_out, regular or
   * sms_consent, and never overwrites a non-null email/phone with null. Returns the stored person.
   */
  upsertLead(lead: Lead, dedupeKey: string): Promise<Person>;

  getPeople(ids: string[]): Promise<Person[]>;

  /** Already-saved people by dedupe key (lets find_people skip paid enrichment for known contacts). */
  getByDedupeKeys(keys: string[]): Promise<Person[]>;

  /** People matching an email or phone (normalized). Used to handle inbound replies. */
  findByContact(contact: { email?: string; phone?: string }): Promise<Person[]>;

  /** Opt-out by email or phone (STOP / unsubscribe). Returns how many people matched. */
  optOut(contact: { email?: string; phone?: string }): Promise<number>;

  /** Mark someone as a regular who wants more jobs (and optionally consents to SMS). */
  setRegular(personId: string, regular: boolean, smsConsent?: boolean): Promise<void>;

  /**
   * Talent pool: people we can contact (email, or consenting regulars with a phone), not opted out, matching ANY term
   * (case-insensitive) in name/headline/snippet/categories/credentials. On-site (remote false): only people within
   * radiusKm when both have coordinates, or without coordinates whose location_text/address mentions the city.
   * Ordered by matched terms, then open_to_work, then recency.
   */
  searchPool(q: PoolQuery): Promise<Person[]>;

  insertOutreach(row: { job_id: string; worker_id: string; channel: Channel; token: string; status: OutreachStatus }): Promise<OutreachRow>;
  listOutreachForJob(jobId: string): Promise<OutreachRow[]>;
  /** The outreach row for a short link token (outreach.token), or null. */
  getOutreachByToken(token: string): Promise<OutreachRow | null>;
  touchContacted(personId: string, at: Date): Promise<void>;

  // ---- manual DM queue (migrations/0002_people.sql: manual_outreach) ----
  /** Queue a drafted DM. Idempotent on (job_id, worker_id, platform): returns the existing task. */
  insertManualTask(t: { job_id: string; worker_id: string; platform: ManualPlatform; profile_url: string; message: string }): Promise<ManualTask>;
  listManualTasks(filter: { job_id?: string; status?: ManualTaskStatus }): Promise<ManualTask[]>;
  markManualTask(id: string, status: 'sent' | 'skipped', at: Date): Promise<void>;
  /** Tasks queued for a platform since a time (daily cap protecting the real sending account). */
  countManualTasksSince(platform: ManualPlatform, since: Date): Promise<number>;

  /** Append a cost row to the ledger: kind 'scrape_cost' | 'sms_cost'. */
  recordCost(jobId: string, kind: 'scrape_cost' | 'sms_cost', amountUsd: number, ref: string): Promise<void>;
}
