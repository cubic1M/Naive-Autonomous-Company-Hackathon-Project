// services/money-verification/src/certs/attorney.ts
// California State Bar licence check for connector legal jobs (policy rule L2). Reads the public licensee
// profile page; robots.txt allowed /attorney/ paths when this was written (2026-11-08). Not legal advice.
import { refreshVerifiedName, verifiedIdentityName } from '../identity.js';
import type { Repo } from '../repo.js';
import type { StripeClient } from '../stripe-client.js';
import { matchNames } from './names.js';

export type FetchText = (url: string) => Promise<{ status: number; body: string }>;

const PROFILE_URL = (n: string) => `https://apps.calbar.ca.gov/attorney/Licensee/Detail/${n}`;
const RECHECK_MS = 30 * 24 * 3600 * 1000;

const defaultFetch: FetchText = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'operis-licence-check/0.1' }, redirect: 'manual' });
  return { status: res.status, body: res.status === 200 ? await res.text() : '' };
};

const clean = (s: string) => s.replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The profile as the page printed it on 2026-11-08: the name in `<h3><b>Name #123456</b></h3>`, then
 * "License Status:" followed by the status, as plain text (Active) or inside a coloured <span>
 * (Inactive, Resigned, Not Eligible to Practice Law).
 */
export function parseCalBarProfile(html: string): { name: string | null; status: string | null } {
  const name = /<h3>\s*<b>([^<#]+)#\s*\d{1,7}\s*<\/b>\s*<\/h3>/.exec(html)?.[1];
  const status = /License Status:\s*(?:<[^>]+>\s*)*([^<]+)</.exec(html)?.[1];
  return { name: name ? clean(name) || null : null, status: status ? clean(status) || null : null };
}

/** A number with no licensee still answers 200: an empty profile titled "# <number> - Attorney Licensee Search". */
const EMPTY_PROFILE = /<title>\s*#\s*\d{1,7}\s*-/;

/**
 * Which name is compared with the State Bar profile: the name on the worker's verified Stripe Identity when one is
 * on file (a typed name proves nothing; the ID ties the licence to the person), otherwise the typed name. With an
 * ID on file the typed name is only cross-checked, and a difference is a reason, not a different outcome (as
 * verifyNotary does).
 */
export async function verifyAttorney(
  deps: {
    repo: Pick<Repo, 'getWorkerVerification' | 'upsertWorkerVerification'>;
    fetchText?: FetchText;
    now?: () => Date;
    /** Refetches a verified name the identity webhook could not fetch (refreshVerifiedName). */
    stripe?: Pick<StripeClient, 'identity'>;
  },
  input: { workerId: string; barNumber: string; name: string },
): Promise<{
  status: 'verified' | 'needs_review' | 'failed';
  reasons: string[];
  name_on_record: string | null;
  licence_status: string | null;
  name_source: 'verified_identity' | 'typed';
}> {
  const now = deps.now?.() ?? new Date();
  const barNumber = input.barNumber.trim();
  const identity = await refreshVerifiedName(deps, input.workerId);
  const nameOnId = verifiedIdentityName(identity);
  const name_source: 'verified_identity' | 'typed' = nameOnId ? 'verified_identity' : 'typed';
  const notes: string[] = [];
  if (identity?.status === 'verified' && !nameOnId) {
    notes.push('id_name_unavailable: the identity is verified but Stripe gave no name for it; the typed name was compared with the State Bar profile');
  }
  if (nameOnId && matchNames(input.name, nameOnId).match !== 'full') {
    notes.push(`typed_name_mismatch: the worker typed "${input.name}" but the verified ID reads "${nameOnId}"; the ID name was compared with the State Bar profile`);
  }
  const done = async (status: 'verified' | 'needs_review' | 'failed', reasons: string[], name_on_record: string | null, licence_status: string | null) => {
    const all = [...reasons, ...notes];
    await deps.repo.upsertWorkerVerification({
      worker_id: input.workerId, kind: 'attorney_license', status, provider_ref: barNumber || null,
      details: {
        name_on_record, licence_status, reasons: all, name_given: input.name, name_used: name_source, name_on_id: nameOnId,
        source: barNumber ? PROFILE_URL(barNumber) : null, checked_at: now.toISOString(),
      },
      verified_at: status === 'verified' ? now : null,
      expires_at: status === 'verified' ? new Date(now.getTime() + RECHECK_MS) : null,
    });
    return { status, reasons: all, name_on_record, licence_status, name_source };
  };
  if (!/^\d{1,7}$/.test(barNumber)) return done('failed', ['invalid_bar_number'], null, null);
  let page: { status: number; body: string };
  try {
    page = await (deps.fetchText ?? defaultFetch)(PROFILE_URL(barNumber));
  } catch {
    return done('needs_review', ['lookup_unavailable'], null, null);
  }
  if (page.status !== 200 || EMPTY_PROFILE.test(page.body)) return done('failed', ['not_found'], null, null);
  const { name, status } = parseCalBarProfile(page.body);
  if (!name || !status) return done('needs_review', ['profile_unreadable'], name, status);
  if (status.toLowerCase() !== 'active') return done('failed', [`licence_not_active: ${status}`], name, status);
  const m = matchNames(nameOnId ?? input.name, name);
  if (m.match === 'full') return done('verified', [], name, status);
  if (m.match === 'partial') return done('needs_review', [`name_partial_match: ${m.reason}`], name, status);
  return done('failed', ['name_mismatch'], name, status);
}
