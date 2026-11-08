/**
 * Seed teammates into the talent pool as REGULARS (people who opted in to receive jobs), so the
 * demo search finds one of us first. Only seed people who agreed to it.
 *
 *   npx tsx scripts/seed-team.ts                      # seeds the default demo teammate into data/pool.json
 *   POOL_FILE=data/pool.json npx tsx scripts/seed-team.ts
 *   DATABASE_URL=postgres://... npx tsx scripts/seed-team.ts   # seed the real (Neon) database instead
 *   SEED_JSON='[{"name":"...","email":"...","headline":"...","skills":["..."]}]' npx tsx scripts/seed-team.ts
 *
 * Demo mode: keep OUTREACH_LIVE=false and set OUTREACH_TEST_ALLOWLIST to the seeded emails. Then only
 * the seeded teammates really receive the email; everyone else found is a dry run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import postgres from 'postgres';
import { InMemoryRepo } from '../src/repo/memory.js';
import { PostgresRepo } from '../src/repo/postgres.js';
import type { Repo } from '../src/repo.js';
import type { Lead } from '../src/types.js';

interface Seed {
  name: string;
  email: string;
  headline: string;
  skills?: string[];
  /** Default: near the YC office in San Francisco. */
  lat?: number;
  lng?: number;
  location_text?: string;
  /** Mobile number (E.164, e.g. +14155550142). Only with the person's OK: enables SMS invites. */
  phone?: string;
  /** The person agreed to receive job texts. Required for any SMS. */
  sms_consent?: boolean;
}

/** YC office (Pier 70), the demo job's location. */
export const YC_PIER70 = { lat: 37.7609, lng: -122.3875, location_text: 'Pier 70, San Francisco, CA' };

const DEFAULT: Seed[] = [
  {
    name: 'Andrew Li',
    email: 'laz.andrewli@gmail.com',
    headline: 'Full-stack TypeScript / React / Next.js developer, Stanford. Available in SF this weekend.',
    skills: ['TypeScript', 'React', 'Next.js', 'Node.js', 'web developer', 'software engineer', 'deploy', 'Vercel'],
  },
];

const seeds: Seed[] = process.env.SEED_JSON ? (JSON.parse(process.env.SEED_JSON) as Seed[]) : DEFAULT;

function toLead(s: Seed): Lead {
  return {
    name: s.name,
    kind: 'person',
    email: s.email,
    phone: s.phone ?? null,
    website: null,
    profile_url: null,
    address: null,
    lat: s.lat ?? 37.7749,
    lng: s.lng ?? -122.4194,
    source: 'seed:team',
    source_ref: s.email,
    categories: s.skills ?? [],
    rating: null,
    snippet: `${s.headline} ${(s.skills ?? []).join(', ')}`.slice(0, 300),
    profiles: [],
    headline: s.headline,
    location_text: s.location_text ?? 'San Francisco, CA',
    credentials: [],
    open_to_work: true,
    last_active_at: new Date().toISOString(),
  };
}

async function seedInto(repo: Repo): Promise<void> {
  for (const s of seeds) {
    const p = await repo.upsertLead(toLead(s), `email:${s.email.toLowerCase()}`);
    await repo.setRegular(p.id, true, s.phone && s.sms_consent ? true : undefined); // opted in to jobs; SMS only with consent
    console.log(`  seeded regular: ${s.name} <${s.email}>${s.phone ? ` ${s.phone}${s.sms_consent ? ' (SMS ok)' : ''}` : ''}`);
  }
}

if (process.env.DATABASE_URL) {
  const sql = postgres(process.env.DATABASE_URL);
  console.log('seeding Postgres (DATABASE_URL)');
  await seedInto(new PostgresRepo(sql));
  await sql.end();
} else {
  const file = resolve(process.env.POOL_FILE ?? 'data/pool.json');
  const repo = existsSync(file) ? InMemoryRepo.fromSnapshot(JSON.parse(readFileSync(file, 'utf8'))) : new InMemoryRepo();
  console.log(`seeding pool file ${file} (${repo.people.size} people before)`);
  await seedInto(repo);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(repo.toSnapshot()));
  console.log(`  pool now has ${repo.people.size} people`);
}
console.log('\nDemo mode: OUTREACH_LIVE=false OUTREACH_TEST_ALLOWLIST=' + seeds.map((s) => s.email).join(','));
