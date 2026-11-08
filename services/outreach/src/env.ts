/**
 * Environment configuration. Modules receive this object; only envFromProcess() reads process.env,
 * so tests build it by hand. Secret values are never logged.
 */
export interface Env {
  MONID_API_KEY: string;
  /** Default https://api.monid.ai */
  MONID_BASE_URL: string;
  /** Base URL of Dora's web app; job links are `${PUBLIC_BASE_URL}/j/${token}`. */
  PUBLIC_BASE_URL: string;
  /** HMAC secret for signed job links (shared with apps/api, which verifies them). */
  LINK_SIGNING_SECRET: string;

  /** Naïve email (ops@ inbox) used to send outreach email. */
  NAIVE_API_KEY?: string;
  /** Default https://api.vetta.sh */
  NAIVE_BASE_URL: string;
  NAIVE_OPS_IDENTITY_ID?: string;
  NAIVE_OPS_INBOX_ID?: string;

  /** Max Monid spend for one find_people call, USD. Default 0.50. */
  OUTREACH_MAX_SPEND_USD: number;
  /** Search radius around the job, km. Default 8. */
  OUTREACH_RADIUS_KM: number;
  /**
   * Safety switch. Unless OUTREACH_LIVE=true, send_blast records outreach rows with status `dry_run`
   * and sends nothing, except to addresses in OUTREACH_TEST_ALLOWLIST.
   */
  OUTREACH_LIVE: boolean;
  /** Comma-separated emails/phones that may receive real messages even when not live (our own phones). */
  OUTREACH_TEST_ALLOWLIST: string[];
  /** Kill switch: when true, send_blast sends nothing at all. */
  PAUSE_OUTREACH: boolean;
  /** Max manual DMs queued per platform per day (protects the real accounts that send them). Default 20. */
  OUTREACH_MANUAL_DAILY_CAP: number;
  /**
   * Draft LinkedIn/X/Reddit/Instagram DMs for a teammate to send (people with no public email).
   * Default false = fully autonomous: only channels Operis sends itself (email, consented SMS).
   */
  OUTREACH_MANUAL_QUEUE: boolean;
  /** Overall wall-clock budget for one find_people call, ms. Default 30000. */
  OUTREACH_TIME_BUDGET_MS?: number;
  /** Timeout for any single Monid call made while finding people, ms. Default 10000. */
  OUTREACH_CALL_TIMEOUT_MS?: number;
  /** Parallel email enrichments. Default 16. */
  OUTREACH_ENRICH_CONCURRENCY?: number;
}

export const DEFAULTS = {
  MONID_BASE_URL: 'https://api.monid.ai',
  NAIVE_BASE_URL: 'https://api.vetta.sh',
  OUTREACH_MAX_SPEND_USD: 0.5,
  OUTREACH_MANUAL_DAILY_CAP: 20,
  OUTREACH_RADIUS_KM: 10,
  OUTREACH_TIME_BUDGET_MS: 30000,
  OUTREACH_CALL_TIMEOUT_MS: 10000,
  OUTREACH_ENRICH_CONCURRENCY: 16,
} as const;

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid number env value: ${value}`);
  return n;
}

function bool(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

function required(source: NodeJS.ProcessEnv, name: string): string {
  const v = source[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export function envFromProcess(source: NodeJS.ProcessEnv = process.env): Env {
  return {
    MONID_API_KEY: required(source, 'MONID_API_KEY'),
    MONID_BASE_URL: (source.MONID_BASE_URL || DEFAULTS.MONID_BASE_URL).replace(/\/+$/, ''),
    PUBLIC_BASE_URL: required(source, 'PUBLIC_BASE_URL').replace(/\/+$/, ''),
    LINK_SIGNING_SECRET: required(source, 'LINK_SIGNING_SECRET'),
    NAIVE_API_KEY: source.NAIVE_API_KEY,
    NAIVE_BASE_URL: (source.NAIVE_BASE_URL || DEFAULTS.NAIVE_BASE_URL).replace(/\/+$/, ''),
    NAIVE_OPS_IDENTITY_ID: source.NAIVE_OPS_IDENTITY_ID,
    NAIVE_OPS_INBOX_ID: source.NAIVE_OPS_INBOX_ID,
    OUTREACH_MAX_SPEND_USD: num(source.OUTREACH_MAX_SPEND_USD, DEFAULTS.OUTREACH_MAX_SPEND_USD),
    OUTREACH_RADIUS_KM: num(source.OUTREACH_RADIUS_KM, DEFAULTS.OUTREACH_RADIUS_KM),
    OUTREACH_LIVE: bool(source.OUTREACH_LIVE),
    OUTREACH_TEST_ALLOWLIST: (source.OUTREACH_TEST_ALLOWLIST ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    PAUSE_OUTREACH: bool(source.PAUSE_OUTREACH),
    OUTREACH_MANUAL_DAILY_CAP: num(source.OUTREACH_MANUAL_DAILY_CAP, DEFAULTS.OUTREACH_MANUAL_DAILY_CAP),
    OUTREACH_MANUAL_QUEUE: bool(source.OUTREACH_MANUAL_QUEUE),
    OUTREACH_TIME_BUDGET_MS: num(source.OUTREACH_TIME_BUDGET_MS, DEFAULTS.OUTREACH_TIME_BUDGET_MS),
    OUTREACH_CALL_TIMEOUT_MS: num(source.OUTREACH_CALL_TIMEOUT_MS, DEFAULTS.OUTREACH_CALL_TIMEOUT_MS),
    OUTREACH_ENRICH_CONCURRENCY: Math.max(1, num(source.OUTREACH_ENRICH_CONCURRENCY, DEFAULTS.OUTREACH_ENRICH_CONCURRENCY)),
  };
}
