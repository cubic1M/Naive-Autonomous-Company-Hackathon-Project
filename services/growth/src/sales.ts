/** The Sales agent's tools: list_prospects, send_marketing, suppress_contact. */
import { normEmail } from '../../outreach/src/geo.js';
import { deliver, logSkip, type SendStatus } from './deliver.js';
import type { GrowthDeps } from './deps.js';
import { decide, RECENT_DAYS } from './guard.js';
import { signLink, unsubscribeUrl } from './links.js';
import { optOutEverywhere } from './optout.js';
import { checkPromo, recordGrant, type PromoCheck } from './promo.js';
import { cleanPersonalLine, firstNameOf, renderMarketing } from './templates.js';
import { DAY_MS, pacificDayStart } from './time.js';

export interface ProspectView {
  contact_id: string;
  name: string | null;
  org: string | null;
  email_domain: string;
  notes: string | null;
  found_via: string;
  free_first_job: boolean;
}

export async function listProspects(deps: GrowthDeps, input: { limit?: number } = {}): Promise<{ prospects: ProspectView[]; used_today: number; daily_cap: number }> {
  const now = deps.now();
  const limit = Math.min(50, Math.max(1, Math.floor(input.limit ?? 20)));
  const rows = await deps.repo.listProspects({ limit, notSentSince: new Date(now.getTime() - RECENT_DAYS * DAY_MS) });
  const today = await deps.repo.messageCountsSince('marketing', pacificDayStart(now));
  return {
    prospects: rows.map((c) => ({
      contact_id: c.id,
      name: c.name,
      org: c.org,
      email_domain: c.email.split('@')[1] ?? '',
      notes: c.notes,
      found_via: c.found_via,
      free_first_job: c.free_first_job,
    })),
    used_today: today.sent + today.dry_run,
    daily_cap: deps.env.GROWTH_SALES_DAILY_CAP,
  };
}

export interface SendMarketingResult {
  contact_id: string;
  status: SendStatus;
  reason?: string;
  promo?: { granted: boolean; cap_usd?: number; expires_at?: string; reason?: string };
}

const SALES_SENDER_HINT = 'set GROWTH_SALES_NAIVE_IDENTITY_ID + GROWTH_SALES_NAIVE_INBOX_ID, or GROWTH_SALES_AGENTMAIL_INBOX';

export async function sendMarketing(
  deps: GrowthDeps,
  input: { contact_id: string; personal_line?: string; offer_free_first_job?: boolean },
): Promise<SendMarketingResult> {
  const { env, repo } = deps;
  const id = input.contact_id;
  const line = cleanPersonalLine(input.personal_line);
  if (!line.ok) return { contact_id: id, status: 'skipped', reason: line.reason };
  const c = await repo.getContact(id);
  if (!c || c.kind !== 'prospect') return { contact_id: id, status: 'skipped', reason: 'not_a_prospect: use contact_id from list_prospects' };

  const decision = await decide(deps, 'marketing', c.email);
  if (decision.action === 'skip') return { contact_id: c.id, ...(await logSkip(deps, c, 'marketing', decision.reason)) };

  const offer: PromoCheck | null = input.offer_free_first_job ? await checkPromo(deps, c) : null;
  const message = renderMarketing({
    firstName: firstNameOf(c.name),
    personalLine: line.line,
    promo: offer?.ok ? { capUsd: offer.capUsd, expiresAt: offer.expiresAt } : null,
    foundVia: c.found_via,
    postalAddress: env.GROWTH_POSTAL_ADDRESS,
    unsubscribeUrl: unsubscribeUrl(env.PUBLIC_BASE_URL, signLink(env.LINK_SIGNING_SECRET, 'unsubscribe', c.id, deps.now())),
  });
  const out = await deliver(deps, { contact: c, kind: 'marketing', decision, message, sender: deps.senders.sales, senderHint: SALES_SENDER_HINT });
  const result: SendMarketingResult = { contact_id: c.id, ...out };
  if (!offer) return result;
  if (!offer.ok) return { ...result, promo: { granted: false, reason: offer.reason } };
  if (out.status !== 'sent') return { ...result, promo: { granted: false, reason: out.status === 'dry_run' ? 'dry_run' : 'not_sent' } };
  const grant = await recordGrant(deps, c, offer);
  return {
    ...result,
    promo: grant ? { granted: true, cap_usd: offer.capUsd, expires_at: offer.expiresAt.toISOString() } : { granted: false, reason: 'already_granted' },
  };
}

export async function suppressContact(
  deps: GrowthDeps,
  input: { email: string; reason: string },
): Promise<{ suppressed: true; matched_contacts: number; matched_workers: number }> {
  const email = normEmail(input.email);
  if (!email) throw new Error('suppress_contact: not an email address');
  const matched = await optOutEverywhere(deps, email);
  await deps.repo.log({ kind: 'suppress', status: 'ok', reason: (input.reason ?? '').slice(0, 200) || null });
  return { suppressed: true, ...matched };
}
