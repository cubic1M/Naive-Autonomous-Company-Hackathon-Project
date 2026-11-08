// Apply SQL migrations in order, once each. Usage: npm run db:migrate
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { ROOT } from "./env";

const MIGRATIONS = ["contracts/schema.sql", "apps/api/migrations/002_edwin.sql", "apps/api/migrations/003_customers_selfserve.sql", "apps/api/migrations/004_proof_files.sql", "services/outreach/migrations/0001_outreach.sql", "services/outreach/migrations/0002_people.sql", "services/money-verification/migrations/0001_money_verification.sql"];
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {} });
await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz default now())`;
for (const name of MIGRATIONS) {
  const done = await sql`select 1 from _migrations where name = ${name}`;
  if (done.length) { console.log(`✓ ${name} (already applied)`); continue; }
  await sql.begin(async (tx) => {
    await tx.unsafe(readFileSync(path.join(ROOT, name), "utf8"));
    await tx`insert into _migrations (name) values (${name})`;
  });
  console.log(`✓ ${name}`);
}
await sql.end();
