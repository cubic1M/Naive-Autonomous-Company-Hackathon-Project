/** The Recruiter's tools: recruit_search (find and save people for a family) and recruit_invite. */
import { linkedinWorkEmail, personEnrichers } from '../../outreach/src/enrich/index.js';
import type { Env as OutreachEnv } from '../../outreach/src/env.js';
import { findPeopleDetailed, type FindDetailed } from '../../outreach/src/find.js';
import { InMemoryRepo } from '../../outreach/src/repo/memory.js';
import type { Enricher } from '../../outreach/src/sources/types.js';
import type { Lead, Person } from '../../outreach/src/types.js';
import { deliver, logSkip, type Outcome, type SendStatus } from './deliver.js';
import type { GrowthDeps } from './deps.js';
import type { GrowthEnv } from './env.js';
import { FAMILIES, PIER70, RADIUS_KM, type Family, type FamilySpec } from './families.js';
import { decide, RECENT_DAYS } from './guard.js';
import { joinUrl, signLink, unsubscribeUrl } from './links.js';
import { isOptedOut } from './optout.js';
import { firstNameOf, renderInvite } from './templates.js';
import { DAY_MS, pacificDayStart } from './time.js';

/** One search never spends more than this, nor more than what is left of today's budget. */
export const SEARCH_CALL_USD = 0.5;
/** Candidates saved per search, to keep one call inside the internal MCP route's 60 s. */
const SAVE_MAX = 30;
const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** Andrew's person enrichers without ContactOut's paid LinkedIn work-email lookup: a bought contact, not a published one. */
export function recruitEnrichers(): Enricher[] {
  return personEnrichers.filter((e) => e.id !== linkedinWorkEmail.id);
}

/** Andrew's Env for a search that can never send anything. */
function searchEnv(g: GrowthEnv, maxSpendUsd: number): OutreachEnv {
  return {
    MONID_API_KEY: g.MONID_API_KEY ?? '',
    MONID_BASE_URL: g.MONID_BASE_URL,
    PUBLIC_BASE_URL: g.PUBLIC_BASE_URL,
    LINK_SIGNING_SECRET: g.LINK_SIGNING_SECRET,
    NAIVE_BASE_URL: g.NAIVE_BASE_URL,
    OUTREACH_MAX_SPEND_USD: maxSpendUsd,
    OUTREACH_RADIUS_KM: RADIUS_KM,
    OUTREACH_LIVE: false,
    OUTREACH_TEST_ALLOWLIST: [],
    PAUSE_OUTREACH: true,
    OUTREACH_MANUAL_DAILY_CAP: 0,
    OUTREACH_MANUAL_QUEUE: false,
    OUTREACH_TIME_BUDGET_MS: 40_000,
    OUTREACH_CALL_TIMEOUT_MS: 12_000,
    OUTREACH_ENRICH_CONCURRENCY: 8,
  };
}

const PLATFORM: Record<string, string> = {
  linkedin: 'LinkedIn profile',
  github: 'GitHub profile',
  x: 'X profile',
  reddit: 'Reddit profile',
  instagram: 'Instagram profile',
  directory: 'directory listing',
  website: 'website',
};
const ORDER = ['linkedin', 'github', 'x', 'reddit', 'instagram', 'directory', 'website'];

/** The invite's "How we found you" line, e.g. `your public GitHub profile, where you list "…"`. */
export function describeFound(p: Pick<Person, 'profiles' | 'headline'>): string {
  const on = ORDER.map((pl) => (p.profiles ?? []).find((x) => x.platform === pl)).find((x) => x !== undefined);
  const base = on ? `your public ${PLATFORM[on.platform]}` : 'your public profile online';
  const head = (p.headline ?? '').replace(/\s+/g, ' ').trim();
  return head ? `${base}, where you list "${head.length > 80 ? `${head.slice(0, 79)}…` : head}"` : base;
}

/** A pool lead from a scratch person. No phone: recruits are never texted. */
function toLead(p: Person): Lead {
  return {
    name: p.name,
    kind: p.kind,
    email: p.email,
    phone: null,
    website: p.website,
    profile_url: p.profile_url,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    source: p.source ?? 'growth:recruit_search',
    source_ref: null,
    categories: p.categories,
    rating: p.rating,
    snippet: p.snippet,
    profiles: p.profiles,
    headline: p.headline,
    location_text: p.location_text,
    credentials: p.credentials,
    open_to_work: p.open_to_work,
    last_active_at: p.last_active_at,
  };
}

export interface RecruitCandidate {
  person_id: string;
  name: string | null;
  headline: string | null;
  source: string;
  score: number;
  distance_km: number | null;
}

export interface RecruitSearchResult {
  family: Family;
  found: number;
  new: number;
  spend_usd: number;
  spend_today_usd: number;
  daily_cap_usd: number;
  error?: string;
  candidates: RecruitCandidate[];
}

/**
 * Find individuals for a family (Andrew's find_people on a scratch job at Pier 70, or remote), save the ones with a
 * public work email to the pool and as recruit contacts, and return the best ones not opted out or invited in 30 days.
 */
export async function recruitSearch(deps: GrowthDeps, input: { family: Family; limit?: number }): Promise<RecruitSearchResult> {
  const { env, repo } = deps;
  const spec = FAMILIES[input.family];
  const limit = Math.min(20, Math.max(1, Math.floor(input.limit ?? 10)));
  const now = deps.now();
  const spentBefore = await repo.searchSpendSince(pacificDayStart(now));
  const head = { family: spec.key, daily_cap_usd: env.GROWTH_SEARCH_DAILY_USD };
  const room = env.GROWTH_SEARCH_DAILY_USD - spentBefore;
  if (room < 0.01) return { ...head, found: 0, new: 0, spend_usd: 0, spend_today_usd: round(spentBefore), candidates: [], error: 'daily_search_budget_used' };
  if (!deps.monid) throw new Error('recruit_search: MONID_API_KEY is not set');

  const scratch = new InMemoryRepo();
  const jobId = `recruit-${spec.key}`;
  scratch.addJob({
    id: jobId,
    title: spec.searchTitle,
    instructions: spec.label,
    address: spec.remote ? null : PIER70.address,
    lat: spec.remote ? null : PIER70.lat,
    lng: spec.remote ? null : PIER70.lng,
    deadline: null,
    budget_usd: 60,
    worker_pay_usd: null,
    certification_required: spec.hints.credential ?? null,
    remote: spec.remote,
    status: 'held',
  });

  let res: FindDetailed | null = null;
  let error: string | null = null;
  try {
    res = await findPeopleDetailed(
      { job_id: jobId, limit: 50, hints: spec.hints },
      {
        repo: scratch,
        monid: deps.monid,
        env: searchEnv(env, Math.min(SEARCH_CALL_USD, room)),
        enrichers: deps.search?.enrichers ?? recruitEnrichers(),
        ...(deps.search?.sources ? { sources: deps.search.sources } : {}),
      },
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const spend = res?.spend_usd ?? 0;
  const sourceErrors = (res?.runs ?? []).filter((r) => r.error && !r.error.startsWith('skipped')).map((r) => `${r.source}: ${r.error}`);
  const problem = (error ?? sourceErrors.join('; ')).slice(0, 300) || null;
  await repo.log({ kind: 'search', status: error ? 'failed' : 'ok', family: spec.key, cost_usd: spend, reason: problem });

  const found = res?.output.candidates ?? [];
  const people = new Map((await scratch.getPeople(found.map((c) => c.candidate_id))).map((p) => [p.id, p]));
  const recentSince = now.getTime() - RECENT_DAYS * DAY_MS;
  let fresh = 0;
  const candidates: RecruitCandidate[] = [];
  for (const cand of found.slice(0, SAVE_MAX)) {
    const p = people.get(cand.candidate_id);
    if (!p || p.kind !== 'person' || !p.email) continue;
    const stored = await deps.pool.upsertLead(toLead(p), p.dedupe_key);
    if (stored.opted_out || !stored.email) continue;
    const { contact, created } = await repo.upsertContact({
      kind: 'recruit',
      email: stored.email,
      name: stored.name,
      family: spec.key,
      worker_id: stored.id,
      found_via: describeFound({ profiles: stored.profiles.length ? stored.profiles : p.profiles, headline: stored.headline ?? p.headline }),
    });
    if (created) fresh++;
    if (contact.opted_out || !contact.worker_id || (await isOptedOut(deps, contact.email))) continue;
    if (contact.last_contacted_at && contact.last_contacted_at.getTime() > recentSince) continue;
    candidates.push({ person_id: contact.worker_id, name: stored.name, headline: stored.headline, source: cand.source, score: cand.score, distance_km: cand.distance_km });
  }
  return {
    ...head,
    found: found.length,
    new: fresh,
    spend_usd: round(spend),
    spend_today_usd: round(spentBefore + spend),
    ...(problem ? { error: problem } : {}),
    candidates: candidates.slice(0, limit),
  };
}

export interface InviteResult {
  person_id: string;
  status: SendStatus;
  reason?: string;
}

export interface RecruitInviteResult {
  sent: number;
  dry_run: number;
  skipped: number;
  failed: number;
  /** Sends + dry runs today: what counts against the cap. */
  used_today: number;
  daily_cap: number;
  results: InviteResult[];
}

const RECRUIT_SENDER_HINT = 'set GROWTH_RECRUIT_AGENTMAIL_INBOX (or AGENTMAIL_INBOX) and MONID_API_KEY';

async function inviteOne(deps: GrowthDeps, spec: FamilySpec, personId: string): Promise<Outcome> {
  const { env, repo } = deps;
  const c = await repo.getRecruitByWorker(personId);
  if (!c) return { status: 'skipped', reason: 'unknown_person: use person_id values from recruit_search' };
  const decision = await decide(deps, 'invite', c.email);
  if (decision.action === 'skip') return logSkip(deps, c, 'invite', decision.reason, spec.key);
  const now = deps.now();
  const message = renderInvite({
    firstName: firstNameOf(c.name),
    familyLabel: spec.label,
    familySubject: spec.subject,
    joinUrl: joinUrl(env.PUBLIC_BASE_URL, signLink(env.LINK_SIGNING_SECRET, 'join', c.id, now)),
    foundVia: c.found_via,
    postalAddress: env.GROWTH_POSTAL_ADDRESS,
    unsubscribeUrl: unsubscribeUrl(env.PUBLIC_BASE_URL, signLink(env.LINK_SIGNING_SECRET, 'unsubscribe', c.id, now)),
  });
  return deliver(deps, { contact: c, kind: 'invite', family: spec.key, decision, message, sender: deps.senders.recruit, senderHint: RECRUIT_SENDER_HINT });
}

/** Invite people from recruit_search to join the pool (join link + ID check), up to 20 per call. */
export async function recruitInvite(deps: GrowthDeps, input: { family: Family; person_ids: string[] }): Promise<RecruitInviteResult> {
  const spec = FAMILIES[input.family];
  const results: InviteResult[] = [];
  for (const personId of [...new Set(input.person_ids)].slice(0, 20)) results.push({ person_id: personId, ...(await inviteOne(deps, spec, personId)) });
  const today = await deps.repo.messageCountsSince('invite', pacificDayStart(deps.now()));
  const count = (s: SendStatus) => results.filter((r) => r.status === s).length;
  return {
    sent: count('sent'),
    dry_run: count('dry_run'),
    skipped: count('skipped'),
    failed: count('failed'),
    used_today: today.sent + today.dry_run,
    daily_cap: deps.env.GROWTH_RECRUIT_DAILY_CAP,
    results,
  };
}
