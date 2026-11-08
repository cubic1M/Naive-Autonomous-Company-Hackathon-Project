/** The free first job: who may get a grant (spec section 11). Redemption is in redeem.ts. */
import type { GrowthDeps } from './deps.js';
import { DAY_MS } from './time.js';
import type { Contact, Grant } from './types.js';

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'icloud.com', 'me.com',
  'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'hey.com', 'fastmail.com',
]);

/** One grant per team: the company domain, or the whole address at free-mail providers. */
export function grantKeyFor(email: string): string {
  const e = email.trim().toLowerCase();
  const domain = e.split('@')[1] ?? '';
  return !domain || FREE_MAIL.has(domain) ? e : domain;
}

export type PromoCheck = { ok: true; capUsd: number; expiresAt: Date } | { ok: false; reason: 'not_eligible' | 'already_granted' | 'max_grants' };

/** Could this prospect get the free first job now? Writes nothing: the grant is recorded only after the email goes out. */
export async function checkPromo(deps: GrowthDeps, c: Contact): Promise<PromoCheck> {
  if (!c.free_first_job) return { ok: false, reason: 'not_eligible' };
  if (await deps.repo.getGrantByKey(grantKeyFor(c.email))) return { ok: false, reason: 'already_granted' };
  if ((await deps.repo.countGrants()) >= deps.env.GROWTH_PROMO_MAX_GRANTS) return { ok: false, reason: 'max_grants' };
  return { ok: true, capUsd: deps.env.GROWTH_PROMO_CAP_USD, expiresAt: new Date(deps.now().getTime() + deps.env.GROWTH_PROMO_DAYS * DAY_MS) };
}

/** Record the grant for an email that really went out. Null when a parallel call took the key first. */
export function recordGrant(deps: GrowthDeps, c: Contact, check: Extract<PromoCheck, { ok: true }>): Promise<Grant | null> {
  return deps.repo.insertGrant({ contact_id: c.id, grant_key: grantKeyFor(c.email), cap_cents: Math.round(check.capUsd * 100), expires_at: check.expiresAt });
}
