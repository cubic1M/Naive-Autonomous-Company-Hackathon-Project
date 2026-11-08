/**
 * Configuration for services/growth (the Sales agent's marketing email and social posts, the Recruiter's invites).
 * Only growthEnvFromProcess() reads process.env, so tests build a GrowthEnv by hand. Secret values are never logged.
 */
import { SOCIAL_PLATFORMS, type SocialPlatform } from './types.js';

export type LiveKind = 'sales' | 'recruit';

export interface GrowthEnv {
  /** Base of every link in our emails, e.g. https://operis.live (operis.live rewrites /v1/* to the API). */
  PUBLIC_BASE_URL: string;
  /** HMAC key for unsubscribe and join links; domain-separated from job links by a "growth:" prefix. */
  LINK_SIGNING_SECRET: string;
  /** Kinds that may email anyone (live also needs GROWTH_POSTAL_ADDRESS). Empty: allowlist and dry runs only. */
  GROWTH_LIVE: LiveKind[];
  /** GROWTH_PAUSE=true or PAUSE_OUTREACH=true: nothing is sent at all. */
  GROWTH_PAUSE: boolean;
  /** Team addresses that may receive real email while not live (shared with services/outreach). Lowercased. */
  OUTREACH_TEST_ALLOWLIST: string[];
  /** CAN-SPAM postal address printed in every email. Live sends are refused without it. */
  GROWTH_POSTAL_ADDRESS: string | null;
  /** Marketing emails (sent + dry runs) per Pacific day. */
  GROWTH_SALES_DAILY_CAP: number;
  /** Invites (sent + dry runs) per Pacific day. */
  GROWTH_RECRUIT_DAILY_CAP: number;
  /** Monid spend per Pacific day for recruit_search, USD. */
  GROWTH_SEARCH_DAILY_USD: number;
  /**
   * Monid spend per Pacific day for reddit_research (read-only), USD; separate from recruit_search's. 0 switches the
   * tool off. GROWTH_LIVE and GROWTH_PAUSE do not apply: they govern email, and this tool sends nothing.
   */
  GROWTH_REDDIT_DAILY_USD: number;
  GROWTH_PROMO_MAX_GRANTS: number;
  GROWTH_PROMO_CAP_USD: number;
  GROWTH_PROMO_DAYS: number;
  MONID_API_KEY: string | null;
  MONID_BASE_URL: string;
  NAIVE_API_KEY: string | null;
  NAIVE_BASE_URL: string;
  /** Naïve Sales identity inbox: marketing goes out from it, so replies wake Sales. */
  GROWTH_SALES_NAIVE_IDENTITY_ID: string | null;
  GROWTH_SALES_NAIVE_INBOX_ID: string | null;
  /** Fallback marketing sender: an AgentMail inbox through Monid. */
  GROWTH_SALES_AGENTMAIL_INBOX: string | null;
  /** Invite sender: an AgentMail inbox through Monid. Defaults to AGENTMAIL_INBOX (Andrew's ops@mail.operis.live). */
  GROWTH_RECRUIT_AGENTMAIL_INBOX: string | null;

  /** Platforms where post_social really posts. Empty (the default): every post is a dry run, logged and never sent. */
  GROWTH_SOCIAL_LIVE: SocialPlatform[];
  /** Kill switch: GROWTH_SOCIAL_PAUSE=true skips every post_social call. GROWTH_PAUSE (and PAUSE_OUTREACH) stop it too. */
  GROWTH_SOCIAL_PAUSE: boolean;
  /** Posts (real, unknown outcome and dry runs) per platform per Pacific day. Never above SOCIAL_DAILY_CAP_MAX. */
  GROWTH_SOCIAL_DAILY_CAP: number;
  /** Zernio (docs.zernio.com) holds the platform tokens; Operis keeps only this key, server-side. */
  ZERNIO_API_KEY: string | null;
  /** The Zernio account (_id from GET /v1/accounts) of Operis's own profile on each platform; nothing else is posted to. */
  ZERNIO_X_ACCOUNT_ID: string | null;
  ZERNIO_THREADS_ACCOUNT_ID: string | null;
  ZERNIO_BLUESKY_ACCOUNT_ID: string | null;
}

/** However GROWTH_SOCIAL_DAILY_CAP is set: far below every platform's limit (Threads allows 250 API posts a day). */
export const SOCIAL_DAILY_CAP_MAX = 10;

export const GROWTH_DEFAULTS = {
  GROWTH_SALES_DAILY_CAP: 25,
  GROWTH_RECRUIT_DAILY_CAP: 40,
  GROWTH_SEARCH_DAILY_USD: 2,
  GROWTH_REDDIT_DAILY_USD: 0.25,
  GROWTH_PROMO_MAX_GRANTS: 20,
  GROWTH_PROMO_CAP_USD: 25,
  GROWTH_PROMO_DAYS: 14,
  MONID_BASE_URL: 'https://api.monid.ai',
  NAIVE_BASE_URL: 'https://api.vetta.sh',
  GROWTH_SOCIAL_DAILY_CAP: 3,
} as const;

const text = (v: string | undefined): string | null => (v !== undefined && v.trim() !== '' ? v.trim() : null);
const flag = (v: string | undefined): boolean => v === 'true' || v === '1';
const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

function num(name: string, v: string | undefined, fallback: number): number {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

function platforms(v: string | undefined): SocialPlatform[] {
  const out = list(v);
  for (const p of out) if (!(SOCIAL_PLATFORMS as readonly string[]).includes(p)) throw new Error(`GROWTH_SOCIAL_LIVE: unknown platform "${p}" (use ${SOCIAL_PLATFORMS.join(', ')})`);
  return out as SocialPlatform[];
}

function required(name: string, v: string | undefined): string {
  const s = text(v);
  if (!s) throw new Error(`${name} is required`);
  return s;
}

export function growthEnvFromProcess(src: NodeJS.ProcessEnv = process.env): GrowthEnv {
  const live = list(src.GROWTH_LIVE);
  for (const k of live) if (k !== 'sales' && k !== 'recruit') throw new Error(`GROWTH_LIVE: unknown kind "${k}" (use sales, recruit)`);
  const d = GROWTH_DEFAULTS;
  return {
    PUBLIC_BASE_URL: required('PUBLIC_BASE_URL', src.PUBLIC_BASE_URL).replace(/\/+$/, ''),
    LINK_SIGNING_SECRET: required('LINK_SIGNING_SECRET', src.LINK_SIGNING_SECRET),
    GROWTH_LIVE: live as LiveKind[],
    GROWTH_PAUSE: flag(src.GROWTH_PAUSE) || flag(src.PAUSE_OUTREACH),
    OUTREACH_TEST_ALLOWLIST: list(src.OUTREACH_TEST_ALLOWLIST),
    GROWTH_POSTAL_ADDRESS: text(src.GROWTH_POSTAL_ADDRESS),
    GROWTH_SALES_DAILY_CAP: num('GROWTH_SALES_DAILY_CAP', src.GROWTH_SALES_DAILY_CAP, d.GROWTH_SALES_DAILY_CAP),
    GROWTH_RECRUIT_DAILY_CAP: num('GROWTH_RECRUIT_DAILY_CAP', src.GROWTH_RECRUIT_DAILY_CAP, d.GROWTH_RECRUIT_DAILY_CAP),
    GROWTH_SEARCH_DAILY_USD: num('GROWTH_SEARCH_DAILY_USD', src.GROWTH_SEARCH_DAILY_USD, d.GROWTH_SEARCH_DAILY_USD),
    GROWTH_REDDIT_DAILY_USD: num('GROWTH_REDDIT_DAILY_USD', src.GROWTH_REDDIT_DAILY_USD, d.GROWTH_REDDIT_DAILY_USD),
    GROWTH_PROMO_MAX_GRANTS: num('GROWTH_PROMO_MAX_GRANTS', src.GROWTH_PROMO_MAX_GRANTS, d.GROWTH_PROMO_MAX_GRANTS),
    GROWTH_PROMO_CAP_USD: num('GROWTH_PROMO_CAP_USD', src.GROWTH_PROMO_CAP_USD, d.GROWTH_PROMO_CAP_USD),
    GROWTH_PROMO_DAYS: num('GROWTH_PROMO_DAYS', src.GROWTH_PROMO_DAYS, d.GROWTH_PROMO_DAYS),
    MONID_API_KEY: text(src.MONID_API_KEY),
    MONID_BASE_URL: (text(src.MONID_BASE_URL) ?? d.MONID_BASE_URL).replace(/\/+$/, ''),
    NAIVE_API_KEY: text(src.NAIVE_API_KEY),
    NAIVE_BASE_URL: (text(src.NAIVE_BASE_URL) ?? d.NAIVE_BASE_URL).replace(/\/+$/, ''),
    GROWTH_SALES_NAIVE_IDENTITY_ID: text(src.GROWTH_SALES_NAIVE_IDENTITY_ID),
    GROWTH_SALES_NAIVE_INBOX_ID: text(src.GROWTH_SALES_NAIVE_INBOX_ID),
    GROWTH_SALES_AGENTMAIL_INBOX: text(src.GROWTH_SALES_AGENTMAIL_INBOX),
    GROWTH_RECRUIT_AGENTMAIL_INBOX: text(src.GROWTH_RECRUIT_AGENTMAIL_INBOX) ?? text(src.AGENTMAIL_INBOX),
    GROWTH_SOCIAL_LIVE: platforms(src.GROWTH_SOCIAL_LIVE),
    GROWTH_SOCIAL_PAUSE: flag(src.GROWTH_SOCIAL_PAUSE),
    GROWTH_SOCIAL_DAILY_CAP: Math.min(SOCIAL_DAILY_CAP_MAX, num('GROWTH_SOCIAL_DAILY_CAP', src.GROWTH_SOCIAL_DAILY_CAP, d.GROWTH_SOCIAL_DAILY_CAP)),
    ZERNIO_API_KEY: text(src.ZERNIO_API_KEY),
    ZERNIO_X_ACCOUNT_ID: text(src.ZERNIO_X_ACCOUNT_ID),
    ZERNIO_THREADS_ACCOUNT_ID: text(src.ZERNIO_THREADS_ACCOUNT_ID),
    ZERNIO_BLUESKY_ACCOUNT_ID: text(src.ZERNIO_BLUESKY_ACCOUNT_ID),
  };
}
