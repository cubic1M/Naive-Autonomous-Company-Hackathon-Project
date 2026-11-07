/**
 * Shared types for the outreach package. Tool input/output shapes mirror contracts/tools.ts exactly:
 * if that file changes, change these.
 */

// ---------- contract shapes (contracts/tools.ts: find_people, send_blast) ----------

export type Channel = 'email' | 'sms';

export interface FindPeopleInput {
  job_id: string;
  limit?: number;
}

export interface Candidate {
  /** workers.id */
  candidate_id: string;
  name: string | null;
  channel: Channel;
  source: string;
  distance_km: number | null;
  /** 0..1, higher is better */
  score: number;
}

export interface FindPeopleOutput {
  candidates: Candidate[];
}

export interface SendBlastInput {
  job_id: string;
  candidate_ids: string[];
}

export interface SendBlastOutput {
  sent: number;
  skipped_opted_out: number;
  outreach_ids: string[];
}

// ---------- the job (read from Edwin's `jobs` table) ----------

export interface JobForOutreach {
  id: string;
  title: string;
  instructions: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  deadline: string | null; // ISO 8601
  budget_usd: number;
  /** What the worker is paid. Null until priced; then fall back to budget * 0.75. */
  worker_pay_usd: number | null;
  certification_required: string | null;
  status: string;
}

// ---------- leads: one normalized shape for every scraper ----------

export type LeadKind = 'business' | 'person';

/** One possible worker found by a source adapter, before dedupe/scoring/saving. */
export interface Lead {
  name: string | null;
  kind: LeadKind;
  email: string | null;
  /** E.164 when we can normalize it (e.g. +14155550142), else null. */
  phone: string | null;
  website: string | null;
  profile_url: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** Machine id of where we found them, e.g. "monid:litescrape/google/maps". */
  source: string;
  /** Stable id inside the source (place_id, permalink, profile id). */
  source_ref: string | null;
  categories: string[];
  rating: number | null;
  /** Short text for relevance scoring (headline, post title, business type). Max ~300 chars. */
  snippet: string | null;
}

// ---------- persisted people (workers + worker_profiles) ----------

export interface Person {
  /** workers.id */
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  opted_out: boolean;
  // worker_profiles (this package's table, migrations/0001_outreach.sql)
  kind: LeadKind;
  website: string | null;
  profile_url: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  categories: string[];
  rating: number | null;
  snippet: string | null;
  /** Said "send me more jobs". Regulars are contacted first and may receive SMS. */
  regular: boolean;
  /** Explicit consent to receive SMS. Never SMS anyone without it. */
  sms_consent: boolean;
  last_contacted_at: string | null;
  dedupe_key: string;
}

export type OutreachStatus = 'sent' | 'opened' | 'accepted' | 'declined' | 'failed' | 'dry_run';

export interface OutreachRow {
  id: string;
  job_id: string;
  worker_id: string;
  channel: Channel;
  token: string;
  status: OutreachStatus;
  created_at: string;
}

// ---------- results that are internal but useful to callers/tests ----------

export interface SourceRun {
  source: string;
  leads: number;
  cost_usd: number;
  error?: string;
}
