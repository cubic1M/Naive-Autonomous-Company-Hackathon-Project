/**
 * The hand-sourced prospect list (hackathon teams, other AI-agent builders) as CSV. Header, any order:
 * email,name,team,found_via,notes,free_first_job. found_via is quoted in the email ("How we found you: …").
 * free_first_job is yes/no (default yes). Errors name the line, never the address.
 */
import type { NewContact } from './types.js';

/** RFC 4180-style CSV: quoted fields may hold commas, quotes ("") and newlines. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NO = new Set(['no', 'n', 'false', '0']);

export function parseProspectsCsv(text: string): { rows: NewContact[]; errors: string[] } {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], errors: ['empty file'] };
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const at = { email: col('email'), name: col('name'), team: col('team'), found: col('found_via'), notes: col('notes'), free: col('free_first_job') };
  if (at.email < 0 || at.found < 0) return { rows: [], errors: ['header needs at least email and found_via'] };
  const rows: NewContact[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  body.forEach((r, i) => {
    const get = (k: number) => (k >= 0 ? (r[k] ?? '').trim() : '');
    const line = i + 2;
    const email = get(at.email).toLowerCase();
    const found = get(at.found).replace(/[.\s]+$/, '');
    if (!EMAIL.test(email)) return void errors.push(`line ${line}: not an email address`);
    if (!found) return void errors.push(`line ${line}: found_via is required (it is quoted in the email)`);
    if (seen.has(email)) return void errors.push(`line ${line}: duplicate address`);
    seen.add(email);
    rows.push({
      kind: 'prospect',
      email,
      name: get(at.name) || null,
      org: get(at.team) || null,
      found_via: found,
      notes: get(at.notes) || null,
      free_first_job: !NO.has(get(at.free).toLowerCase()),
    });
  });
  return { rows, errors };
}
