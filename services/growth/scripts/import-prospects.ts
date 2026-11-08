/**
 * Load hand-sourced prospects (hackathon teams, other AI-agent builders) into growth_contacts.
 *
 *   npx tsx scripts/import-prospects.ts teams.csv                         # check the file, write nothing
 *   DATABASE_URL=postgres://... npx tsx scripts/import-prospects.ts teams.csv --write
 *
 * CSV header (any order): email,name,team,found_via,notes,free_first_job (see src/prospects.ts). Addresses that are
 * opted out stay opted out. Never commit the CSV: it holds people's contact details.
 */
import { readFileSync } from 'node:fs';
import { parseProspectsCsv } from '../src/prospects.js';
import { dbFromPostgresJs, PostgresGrowthRepo } from '../src/repo/postgres.js';

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('usage: npx tsx scripts/import-prospects.ts <file.csv> [--write]');
  process.exit(1);
}
const { rows, errors } = parseProspectsCsv(readFileSync(file, 'utf8'));
for (const e of errors) console.error(`  skipped ${e}`);
console.log(`${rows.length} prospects ready (${rows.filter((r) => r.free_first_job).length} with the free first job), ${errors.length} rows skipped`);
if (!flags.includes('--write')) {
  console.log('Checked only: nothing written. Add --write (and DATABASE_URL) to import.');
  process.exit(0);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required with --write');
  process.exit(1);
}
const { default: postgres } = await import('postgres');
const sql = postgres(url, { max: 2, prepare: false, onnotice: () => {} });
const repo = new PostgresGrowthRepo(dbFromPostgresJs(sql));
let created = 0;
let merged = 0;
let optedOut = 0;
for (const r of rows) {
  const { contact, created: isNew } = await repo.upsertContact(r);
  if (isNew) created++;
  else merged++;
  if (contact.opted_out) optedOut++;
}
console.log(`imported: ${created} new, ${merged} merged, ${optedOut} already opted out (they will not be emailed)`);
await sql.end();
