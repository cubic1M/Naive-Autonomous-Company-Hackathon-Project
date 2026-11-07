import type { Channel, JobForOutreach, Lead, OutreachRow, OutreachStatus, Person } from './types.js';

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

  /** Opt-out by email or phone (STOP / unsubscribe). Returns how many people matched. */
  optOut(contact: { email?: string; phone?: string }): Promise<number>;

  /** Mark someone as a regular who wants more jobs (and optionally consents to SMS). */
  setRegular(personId: string, regular: boolean, smsConsent?: boolean): Promise<void>;

  insertOutreach(row: { job_id: string; worker_id: string; channel: Channel; token: string; status: OutreachStatus }): Promise<OutreachRow>;
  listOutreachForJob(jobId: string): Promise<OutreachRow[]>;
  touchContacted(personId: string, at: Date): Promise<void>;

  /** Append a cost row to the ledger: kind 'scrape_cost' | 'sms_cost'. */
  recordCost(jobId: string, kind: 'scrape_cost' | 'sms_cost', amountUsd: number, ref: string): Promise<void>;
}
