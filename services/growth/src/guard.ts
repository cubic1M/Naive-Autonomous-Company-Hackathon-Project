import type { GrowthDeps } from './deps.js';
import type { GrowthEnv } from './env.js';
import { isOptedOut } from './optout.js';
import { contactKindFor } from './repo.js';
import { DAY_MS, pacificDayStart } from './time.js';
import type { MessageKind } from './types.js';

export type SkipReason = 'paused' | 'opted_out' | 'recently_contacted' | 'daily_cap';
export type Decision = { action: 'send'; mode: 'live' | 'test' } | { action: 'dry_run' } | { action: 'skip'; reason: SkipReason };

/** No second message of the same kind to the same address within this many days. */
export const RECENT_DAYS = 30;

export const dailyCap = (env: GrowthEnv, kind: MessageKind): number =>
  kind === 'marketing' ? env.GROWTH_SALES_DAILY_CAP : env.GROWTH_RECRUIT_DAILY_CAP;

/**
 * May one marketing email or invite go to `email`, and how? The only place the sending rules live:
 * 1. paused → skip; 2. opted out anywhere → skip; 3. a real send of this kind in the last 30 days → skip (the team
 * allowlist is exempt so tests can repeat); 4. today's sends + dry runs at the cap → skip; 5. the kind is live and a
 * postal address is set → send; 6. allowlisted → send as a test; 7. otherwise → dry run (logged, nothing sent).
 */
export async function decide(deps: GrowthDeps, kind: MessageKind, email: string): Promise<Decision> {
  const { env, repo } = deps;
  const now = deps.now();
  const addr = email.trim().toLowerCase();
  if (env.GROWTH_PAUSE) return { action: 'skip', reason: 'paused' };
  if (await isOptedOut(deps, addr)) return { action: 'skip', reason: 'opted_out' };
  const allowlisted = env.OUTREACH_TEST_ALLOWLIST.includes(addr);
  const last = await repo.lastSentAt(addr, contactKindFor(kind));
  if (!allowlisted && last && now.getTime() - last.getTime() < RECENT_DAYS * DAY_MS) return { action: 'skip', reason: 'recently_contacted' };
  const used = await repo.messageCountsSince(kind, pacificDayStart(now));
  if (used.sent + used.dry_run >= dailyCap(env, kind)) return { action: 'skip', reason: 'daily_cap' };
  const liveKind = kind === 'marketing' ? 'sales' : 'recruit';
  if (env.GROWTH_LIVE.includes(liveKind) && env.GROWTH_POSTAL_ADDRESS) return { action: 'send', mode: 'live' };
  if (allowlisted) return { action: 'send', mode: 'test' };
  return { action: 'dry_run' };
}
