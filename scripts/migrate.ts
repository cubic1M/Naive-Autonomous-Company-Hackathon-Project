// Apply SQL migrations in order, once each. Usage: npm run db:migrate
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { ROOT } from "./env";

const MIGRATIONS = ["contracts/schema.sql", "apps/api/migrations/002_edwin.sql", "apps/api/migrations/003_customers_selfserve.sql", "apps/api/migrations/004_proof_files.sql", "apps/api/migrations/005_workers_email.sql", "apps/api/migrations/006_agent_feed.sql", "apps/api/migrations/007_oauth.sql", "apps/api/migrations/008_admin_login.sql", "apps/api/migrations/009_worker_accounts.sql", "apps/api/migrations/010_google_login.sql", "apps/api/migrations/011_login_history.sql", "apps/api/migrations/012_api_calls.sql", "apps/api/migrations/013_x402_payments.sql", "services/outreach/migrations/0001_outreach.sql", "services/outreach/migrations/0002_people.sql", "services/outreach/migrations/0003_pool.sql", "services/money-verification/migrations/0001_money_verification.sql", "services/money-verification/migrations/0002_customer_payment.sql", "services/money-verification/migrations/0003_job_liability.sql", "services/money-verification/migrations/0004_job_liability_backfill.sql", "services/money-verification/migrations/0005_stripe_livemode.sql", "services/growth/migrations/0001_growth.sql"];
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
