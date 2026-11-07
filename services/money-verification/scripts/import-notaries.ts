/**
 * Import the California Secretary of State notary listing.
 *
 *   npx vite-node scripts/import-notaries.ts -- <file> [--dry-run] [--delimiter=tab|comma]
 *        [--map=commissionNumber:Comm No,expires:Exp Date,...]
 *
 * --dry-run parses into an in-memory repo and prints a summary. Without it, DATABASE_URL must be set
 * and rows are upserted into notary_registry in batches of 1000.
 * --map keys are NotaryColumnMap field names; the value is the exact header text in the file.
 */
import fs from 'node:fs';
import { Pool } from '@neondatabase/serverless';
import { importNotaryListing, parseNotaryListing, type NotaryColumnMap, type ParseOptions } from '../src/certs/notary.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import { PostgresRepo } from '../src/repo/postgres.js';
import type { Repo } from '../src/repo.js';

const BATCH = 1000;

interface CliArgs {
  file: string;
  dryRun: boolean;
  parse: ParseOptions;
}

const FIELDS: (keyof NotaryColumnMap)[] = [
  'commissionNumber', 'fullName', 'firstName', 'lastName', 'middleName', 'expires', 'county', 'city', 'businessName',
];

/** Parse argv (after vite-node's own args). Throws a usage message on bad input. */
function parseArgs(argv: string[]): CliArgs {
  let file: string | undefined;
  let dryRun = false;
  const parse: ParseOptions = {};
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--delimiter=')) {
      const v = arg.slice('--delimiter='.length);
      const map: Record<string, ParseOptions['delimiter']> = { tab: '\t', comma: ',', semicolon: ';', pipe: '|' };
      const d = map[v];
      if (!d) throw new Error(`Unknown delimiter "${v}" (use tab, comma, semicolon or pipe)`);
      parse.delimiter = d;
    } else if (arg.startsWith('--map=')) {
      const columns: Partial<NotaryColumnMap> = {};
      for (const pair of arg.slice('--map='.length).split(',')) {
        const sep = pair.indexOf(':');
        const field = pair.slice(0, sep).trim() as keyof NotaryColumnMap;
        const header = pair.slice(sep + 1).trim();
        if (sep < 0 || !FIELDS.includes(field) || header === '') {
          throw new Error(`Bad --map entry "${pair}". Fields: ${FIELDS.join(', ')}`);
        }
        columns[field] = [header];
      }
      parse.columns = columns;
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else file = arg;
  }
  if (!file) throw new Error('Usage: import-notaries.ts -- <file> [--dry-run] [--delimiter=tab|comma] [--map=field:Header,...]');
  return { file, dryRun, parse };
}

const day = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : 'null');

async function dryRun(text: string, parse: ParseOptions): Promise<void> {
  const parsed = parseNotaryListing(text, parse);
  const repo = new InMemoryRepo();
  const result = await importNotaryListing(repo, text, parse);
  console.log(`headers:    ${parsed.headers.join(' | ')}`);
  console.log(`delimiter:  ${JSON.stringify(parsed.delimiter)}`);
  console.log(`records:    ${result.imported} (distinct commission numbers: ${repo.notaries.size})`);
  console.log(`skipped:    ${result.skipped.length}`);
  for (const s of result.skipped.slice(0, 5)) console.log(`  line ${s.line}: ${s.reason}`);
  console.log('samples:');
  for (const r of parsed.records.slice(0, 3)) {
    console.log(
      `  ${r.commission_number} | ${r.full_name} -> "${r.name_normalized}" | expires ${day(r.commission_expires)} | ${r.county ?? '-'}, ${r.city ?? '-'}`,
    );
  }
}

async function realImport(text: string, parse: ParseOptions): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set (use --dry-run to test without a database)');
  const { records, skipped, headers } = parseNotaryListing(text, parse);
  console.log(`parsed ${records.length} records, skipped ${skipped.length}; headers: ${headers.join(' | ')}`);
  for (const s of skipped.slice(0, 5)) console.log(`  skipped line ${s.line}: ${s.reason}`);

  const pool = new Pool({ connectionString });
  try {
    const repo: Pick<Repo, 'upsertNotaries'> = new PostgresRepo(pool);
    let done = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      await repo.upsertNotaries(batch);
      done += batch.length;
      console.log(`imported ${done}/${records.length}`);
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const text = fs.readFileSync(args.file, 'utf8');
  if (args.dryRun) await dryRun(text, args.parse);
  else await realImport(text, args.parse);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
