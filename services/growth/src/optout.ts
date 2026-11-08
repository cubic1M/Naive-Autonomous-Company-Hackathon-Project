import type { GrowthDeps } from './deps.js';

/** Opted out in growth (any contact row with the address) or in Andrew's pool (workers.opted_out). */
export async function isOptedOut(deps: Pick<GrowthDeps, 'repo' | 'pool'>, email: string): Promise<boolean> {
  const addr = email.trim().toLowerCase();
  if (await deps.repo.isSuppressed(addr)) return true;
  return (await deps.pool.findByContact({ email: addr })).some((p) => p.opted_out);
}

/**
 * Stop all Operis email to an address, forever: every growth contact with it (or a suppression row when there is
 * none) and every workers row with it, through Andrew's optOut, so Ops' send_blast skips it too.
 */
export async function optOutEverywhere(
  deps: Pick<GrowthDeps, 'repo' | 'pool' | 'now'>,
  email: string,
): Promise<{ matched_contacts: number; matched_workers: number }> {
  const addr = email.trim().toLowerCase();
  const matched_contacts = await deps.repo.optOutEmail(addr, deps.now());
  const matched_workers = await deps.pool.optOut({ email: addr });
  return { matched_contacts, matched_workers };
}
