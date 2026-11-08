import type { Family } from './families.js';

export type ContactKind = 'prospect' | 'recruit';
export type MessageKind = 'marketing' | 'invite';
export type LogKind = MessageKind | 'search' | 'unsubscribe' | 'join' | 'identity' | 'suppress';
export type LogStatus = 'sent' | 'dry_run' | 'skipped' | 'failed' | 'ok';

/** Someone we may email: a hand-sourced prospect (Sales) or a recruit found by recruit_search (Recruiter). */
export interface Contact {
  id: string;
  kind: ContactKind;
  /** Lowercased. */
  email: string;
  name: string | null;
  org: string | null;
  family: Family | null;
  /** Recruits: workers.id in Andrew's pool. */
  worker_id: string | null;
  /** Quoted in every email: "How we found you: <found_via>." */
  found_via: string;
  notes: string | null;
  free_first_job: boolean;
  opted_out: boolean;
  joined_at: Date | null;
  /** Last real send (status sent) to this contact. */
  last_contacted_at: Date | null;
  created_at: Date;
}

export interface NewContact {
  kind: ContactKind;
  email: string;
  name?: string | null;
  org?: string | null;
  family?: Family | null;
  worker_id?: string | null;
  found_via: string;
  notes?: string | null;
  free_first_job?: boolean;
}

export interface LogEntry {
  contact_id?: string | null;
  kind: LogKind;
  status: LogStatus;
  reason?: string | null;
  family?: Family | null;
  cost_usd?: number;
  ref?: string | null;
}

/** A free-first-job grant (growth_promos). */
export interface Grant {
  id: string;
  contact_id: string;
  /** The company domain, or the full address at free-mail providers. */
  grant_key: string;
  cap_cents: number;
  expires_at: Date;
  redeemed_job_id: string | null;
  refund_cents: number | null;
  redeemed_at: Date | null;
  created_at: Date;
}

/** Read-only view of Edwin's jobs table, for demand. */
export interface JobRow {
  id: string;
  title: string;
  instructions: string;
  certification_required: string | null;
  lat: number | null;
  lng: number | null;
  remote: boolean;
  status: string;
  worker_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/** A job and its customer's contact (jobs + customers), for the free first job. */
export interface JobWithCustomer {
  job_id: string;
  customer_id: string | null;
  customer_name: string | null;
  /** Lowercased. */
  contact_email: string | null;
  budget_usd: number;
  status: string;
  created_at: Date;
}

/** Read-only view of Cameron's worker_verifications. */
export interface VerificationRow {
  worker_id: string;
  kind: string;
  status: string;
}
