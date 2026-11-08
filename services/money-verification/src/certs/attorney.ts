// services/money-verification/src/certs/attorney.ts
// California State Bar licence check for connector legal jobs (policy rule L2). Reads the public licensee
// profile page; robots.txt allowed /attorney/ paths when this was written (2026-11-08). Not legal advice.
import type { Repo } from '../repo.js';
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

export async function verifyAttorney(
  deps: { repo: Pick<Repo, 'upsertWorkerVerification'>; fetchText?: FetchText; now?: () => Date },
  input: { workerId: string; barNumber: string; name: string },
): Promise<{ status: 'verified' | 'needs_review' | 'failed'; reasons: string[]; name_on_record: string | null; licence_status: string | null }> {
  const now = deps.now?.() ?? new Date();
  const barNumber = input.barNumber.trim();
  const done = async (status: 'verified' | 'needs_review' | 'failed', reasons: string[], name_on_record: string | null, licence_status: string | null) => {
    await deps.repo.upsertWorkerVerification({
      worker_id: input.workerId, kind: 'attorney_license', status, provider_ref: barNumber || null,
      details: { name_on_record, licence_status, reasons, source: barNumber ? PROFILE_URL(barNumber) : null, checked_at: now.toISOString() },
      verified_at: status === 'verified' ? now : null,
      expires_at: status === 'verified' ? new Date(now.getTime() + RECHECK_MS) : null,
    });
    return { status, reasons, name_on_record, licence_status };
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
  const m = matchNames(input.name, name);
  if (m.match === 'full') return done('verified', [], name, status);
  if (m.match === 'partial') return done('needs_review', [`name_partial_match: ${m.reason}`], name, status);
  return done('failed', ['name_mismatch'], name, status);
}
