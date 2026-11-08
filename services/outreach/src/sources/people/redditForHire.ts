import type { Lead, Profile } from '../../types.js';
import { arr, callMonid, perQueryRun, rec, str, type SourceAdapter, type SourceContext } from '../types.js';
import { addProfile, extractEmails, isoFromUnix, personLead, profilesFromText } from './common.js';
import { cityFromAddress } from './googleProfiles.js';

export const REDDIT_FOR_HIRE_ID = 'monid:anyapi/reddit.subreddit_search';
const FOR_HIRE = /\[\s*for\s*hire\s*\]/i;
const SKIP_LINK = /reddit\.com|redd\.it|imgur|preview\./i;

export interface RedditQuery {
  subreddit: string;
  query: string;
}

/** Pure: r/forhire always; r/sanfrancisco + r/bayarea for on-site SF jobs. */
export function buildRedditQueries(ctx: Pick<SourceContext, 'job' | 'hints' | 'remote'>): RedditQuery[] {
  const role = ctx.hints.roles[0] ?? ctx.job.title;
  const out: RedditQuery[] = [{ subreddit: 'forhire', query: `[For Hire] ${role}` }];
  const city = ctx.remote ? null : cityFromAddress(ctx.job.address);
  if (city && /san francisco|bay area/i.test(city)) {
    out.push({ subreddit: 'sanfrancisco', query: '[For Hire]' }, { subreddit: 'bayarea', query: '[For Hire]' });
  }
  return out;
}

/** Only posts titled "[For Hire]"; the author becomes a reddit profile. */
export function parseRedditForHire(output: unknown): Lead[] {
  const leads: Lead[] = [];
  for (const raw of arr(rec(rec(output)?.data)?.posts)) {
    const p = rec(raw);
    const author = str(p?.author);
    const title = str(p?.title);
    if (!p || !author || !title || author === '[deleted]' || !FOR_HIRE.test(title)) continue;
    const body = str(p.selftext) ?? '';
    const profiles: Profile[] = [{ platform: 'reddit', url: `https://www.reddit.com/user/${author}`, handle: author }];
    for (const pr of profilesFromText(body, SKIP_LINK)) addProfile(profiles, pr);
    const clean = title.replace(FOR_HIRE, '').trim();
    leads.push(
      personLead({
        name: author,
        source: REDDIT_FOR_HIRE_ID,
        source_ref: str(p.id) ?? author,
        profiles,
        headline: clean.slice(0, 200) || null,
        snippet: `${title} — ${body.replace(/\s+/g, ' ')}`,
        email: extractEmails(body)[0] ?? null,
        open_to_work: true,
        last_active_at: isoFromUnix(typeof p.createdUtc === 'number' ? p.createdUtc : Number(p.createdUtc) || null),
      }),
    );
  }
  return leads;
}

export const redditForHire: SourceAdapter = {
  id: REDDIT_FOR_HIRE_ID,
  costEstimateUsd: 0.0008,
  perQuery: true,
  run(ctx) {
    const qs = buildRedditQueries(ctx);
    return perQueryRun({ ...ctx, queries: qs.map((_, i) => String(i)) }, async (i) => {
      const { subreddit, query } = qs[Number(i)]!;
      const r = await callMonid(ctx.monid, 'anyapi', '/reddit.subreddit_search', { body: { subreddit, query, sort: 'new' } });
      return { leads: parseRedditForHire(r.output), cost_usd: r.cost_usd };
    });
  },
};
