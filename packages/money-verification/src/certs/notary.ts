/**
 * California notary public verification. The Secretary of State publishes the commissioned-notary
 * listing as a downloadable CSV/TSV whose exact headers and date format we have not seen, so the
 * importer is tolerant (configurable column names, several date formats). A worker's typed
 * commission number and name are then checked against the imported registry before they may take
 * a notarization job. We never ask for or store anything about a notary's journal (policy).
 */
import type { Repo } from '../repo.js';
import type { NotaryRecord, VerificationStatus } from '../types.js';
import { matchNames, normalizeName, type NameMatch } from './names.js';

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

/** Candidate header names per field; matched case-insensitively after stripping non-letters. */
export interface NotaryColumnMap {
  commissionNumber: string[];
  fullName: string[];
  firstName: string[];
  lastName: string[];
  middleName: string[];
  expires: string[];
  county: string[];
  city: string[];
  businessName: string[];
}

export const DEFAULT_NOTARY_COLUMNS: NotaryColumnMap = {
  commissionNumber: ['commission number', 'commission no', 'commission #', 'commission_number', 'comm no', 'comm number', 'commission'],
  fullName: ['name', 'notary name', 'full name', 'commissioned name', 'notary'],
  firstName: ['first name', 'first'],
  lastName: ['last name', 'last', 'surname'],
  middleName: ['middle name', 'middle', 'mi'],
  expires: [
    'expiration date', 'expiration', 'expires', 'exp date', 'commission expiration',
    'commission expiration date', 'expire date', 'term expires',
  ],
  county: ['county'],
  city: ['city'],
  businessName: ['business name', 'business', 'employer'],
};

export interface ParseOptions {
  columns?: Partial<NotaryColumnMap>;
  delimiter?: ',' | '\t' | ';' | '|';
}

export interface ParseResult {
  records: NotaryRecord[];
  skipped: { line: number; reason: string }[];
  headers: string[];
  delimiter: string;
}

/** Header comparison key: letters only, lower case ("Commission #" and "commission" collide on purpose). */
const headerKey = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');

type FieldName = keyof NotaryColumnMap;

/** Index of the first header matching any candidate (candidates are in priority order), or -1. */
function findColumn(headers: string[], candidates: string[]): number {
  const keys = headers.map(headerKey);
  for (const c of candidates) {
    const i = keys.indexOf(headerKey(c));
    if (i >= 0) return i;
  }
  return -1;
}

function mapColumns(headers: string[], overrides: Partial<NotaryColumnMap> | undefined): Record<FieldName, number> {
  const merged: NotaryColumnMap = { ...DEFAULT_NOTARY_COLUMNS, ...overrides };
  const out = {} as Record<FieldName, number>;
  for (const field of Object.keys(merged) as FieldName[]) out[field] = findColumn(headers, merged[field]);

  const missing: string[] = [];
  if (out.commissionNumber < 0) missing.push('commissionNumber');
  if (out.expires < 0) missing.push('expires');
  if (out.fullName < 0 && (out.firstName < 0 || out.lastName < 0)) missing.push('fullName (or firstName and lastName)');
  if (missing.length > 0) {
    throw new Error(
      `Cannot map notary listing columns. Headers found: ${headers.map((h) => `"${h}"`).join(', ')}. ` +
        `Missing fields: ${missing.join(', ')}. Pass a column mapping, e.g. { commissionNumber: ['<header>'] }.`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Delimited text
// ---------------------------------------------------------------------------

const DELIMITERS = ['\t', ',', ';', '|'] as const;

/** Picks the delimiter that occurs most in the header line (tab wins ties by order). */
function detectDelimiter(headerLine: string): string {
  let best: string = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const count = headerLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Minimal RFC-4180 field splitter for one line. Quoted fields may contain the delimiter and use ""
 * for a literal quote; embedded newlines are not supported because the listing is split by line first.
 */
function splitFields(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** UTC-midnight Date for a calendar day, or null if the day does not exist (e.g. Feb 30). */
function calendarDate(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

/**
 * Parse a listing date as a calendar day at UTC midnight, so comparisons never depend on the
 * server's time zone. Supports MM/DD/YYYY, M/D/YYYY, MM/DD/YY (20YY), YYYY-MM-DD, YYYYMMDD and
 * "Mon DD, YYYY"; a trailing time of day is ignored.
 */
export function parseListingDate(value: string): Date | null {
  const v = value.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:[ T]\d.*)?$/.exec(v);
  if (m) {
    const year = m[3] as string;
    return calendarDate(year.length === 2 ? 2000 + Number(year) : Number(year), Number(m[1]), Number(m[2]));
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d.*)?$/.exec(v);
  if (m) return calendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return calendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(v);
  if (m) {
    const month = MONTHS.indexOf((m[1] as string).toLowerCase());
    return month < 0 ? null : calendarDate(Number(m[3]), month + 1, Number(m[2]));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parse + import
// ---------------------------------------------------------------------------

/** Commission numbers are compared without punctuation or case ("A-123 456" == "A123456"). */
export function normalizeCommissionNumber(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

const nullIfEmpty = (s: string | undefined): string | null => {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
};

/** Parse the downloaded listing. Bad rows are skipped with a reason rather than failing the import. */
export function parseNotaryListing(text: string, opts: ParseOptions = {}): ParseResult {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.trim() !== '');
  if (headerIdx < 0) throw new Error('Notary listing is empty');

  const headerLine = lines[headerIdx] as string;
  const delimiter = opts.delimiter ?? detectDelimiter(headerLine);
  const headers = splitFields(headerLine, delimiter).map((h) => h.trim());
  const col = mapColumns(headers, opts.columns);

  const records: NotaryRecord[] = [];
  const skipped: ParseResult['skipped'] = [];
  const cell = (fields: string[], index: number): string => (index < 0 ? '' : (fields[index] ?? '').trim());

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === '') continue;
    const lineNo = i + 1;
    const fields = splitFields(line, delimiter);

    const commission = normalizeCommissionNumber(cell(fields, col.commissionNumber));
    if (commission === '') {
      skipped.push({ line: lineNo, reason: 'missing commission number' });
      continue;
    }
    const fullName =
      cell(fields, col.fullName) ||
      [cell(fields, col.firstName), cell(fields, col.middleName), cell(fields, col.lastName)].filter(Boolean).join(' ');
    if (fullName === '') {
      skipped.push({ line: lineNo, reason: 'missing name' });
      continue;
    }
    const expiresRaw = cell(fields, col.expires);
    const expires = parseListingDate(expiresRaw);
    if (!expires) {
      skipped.push({ line: lineNo, reason: `unparseable expiration date "${expiresRaw}"` });
      continue;
    }

    const raw: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      raw[h] = (fields[idx] ?? '').trim();
    });
    records.push({
      commission_number: commission,
      full_name: fullName,
      name_normalized: normalizeName(fullName),
      county: nullIfEmpty(cell(fields, col.county)),
      city: nullIfEmpty(cell(fields, col.city)),
      business_name: nullIfEmpty(cell(fields, col.businessName)),
      commission_expires: expires,
      raw,
    });
  }
  return { records, skipped, headers, delimiter };
}

/** Parse and write the listing through the repo in batches (~150k rows, so never one giant statement). */
export async function importNotaryListing(
  repo: Pick<Repo, 'upsertNotaries'>,
  text: string,
  opts: ParseOptions & { batchSize?: number } = {},
): Promise<{ imported: number; skipped: ParseResult['skipped']; headers: string[] }> {
  const { records, skipped, headers } = parseNotaryListing(text, opts);
  const batchSize = Math.max(1, opts.batchSize ?? 1000);
  for (let i = 0; i < records.length; i += batchSize) {
    await repo.upsertNotaries(records.slice(i, i + batchSize));
  }
  return { imported: records.length, skipped, headers };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface VerifyNotaryInput {
  workerId: string;
  commissionNumber: string;
  name: string;
  jobDate: Date;
}

export interface VerifyNotaryResult {
  status: VerificationStatus;
  reasons: string[];
  record: NotaryRecord | null;
  nameMatch: NameMatch;
}

/** Calendar day of an instant in California, as UTC-midnight milliseconds comparable to listing dates. */
function californiaDay(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'));
}

/**
 * Check a worker's claimed commission against the imported registry and record the outcome in
 * worker_verifications.
 *
 * Expiry rule: a commission is valid through the END of its expiration day. The job counts as
 * expired only if the job's California calendar day is after the expiration date. (California time,
 * not UTC, so a 5pm job on the last day is not wrongly rejected.) Expired always fails, whatever the name.
 * Only a full name match verifies automatically; a partial match needs human review.
 */
export async function verifyNotary(
  deps: { repo: Pick<Repo, 'getNotary' | 'upsertWorkerVerification'>; now?: () => Date },
  input: VerifyNotaryInput,
): Promise<VerifyNotaryResult> {
  const now = deps.now ?? (() => new Date());
  const commission = normalizeCommissionNumber(input.commissionNumber);
  const record = commission === '' ? null : await deps.repo.getNotary(commission);

  let status: VerificationStatus;
  let reasons: string[];
  let nameMatch: NameMatch = 'none';

  if (!record) {
    status = 'failed';
    reasons = ['commission_not_found'];
  } else {
    const match = matchNames(input.name, record.full_name);
    nameMatch = match.match;
    if (record.commission_expires === null) {
      status = 'needs_review';
      reasons = ['expiry_unknown'];
    } else if (record.commission_expires.getTime() < californiaDay(input.jobDate)) {
      status = 'failed';
      reasons = ['commission_expired'];
    } else if (match.match === 'full') {
      status = 'verified';
      reasons = [];
    } else if (match.match === 'partial') {
      status = 'needs_review';
      reasons = [`name_partial_match: ${match.reason}`];
    } else {
      status = 'failed';
      reasons = ['name_mismatch'];
    }
  }

  await deps.repo.upsertWorkerVerification({
    worker_id: input.workerId,
    kind: 'notary_commission',
    status,
    provider_ref: commission === '' ? null : commission,
    details: {
      commission_number: commission,
      name_given: input.name,
      name_on_record: record?.full_name ?? null,
      name_match: nameMatch,
      reasons,
      job_date: input.jobDate.toISOString(),
    },
    verified_at: status === 'verified' ? now() : null,
    expires_at: record?.commission_expires ?? null,
  });

  return { status, reasons, record, nameMatch };
}
