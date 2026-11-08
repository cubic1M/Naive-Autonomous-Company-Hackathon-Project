/**
 * post_social: the Sales agent's posts from Operis's OWN accounts on X, Threads and Bluesky. Every rule is enforced
 * here, in code; the prompt only explains them. One call is one post on one platform and one growth_social_posts row.
 */
import { createHash } from 'node:crypto';
import type { GrowthDeps } from './deps.js';
import type { GrowthEnv } from './env.js';
import { DAY_MS, pacificDate, pacificDayStart } from './time.js';
import type { SocialPlatform, SocialPost, SocialPostStatus } from './types.js';

/** Appended to every post. Zernio exposes no AI label for text posts (zernio.ts), so this line is the disclosure. */
export const DISCLOSURE = "Written and posted by Operis's AI agent.";
/** What follows the agent's text in every post: a blank line, then the disclosure. Counts toward every limit. */
const TAIL = `\n\n${DISCLOSURE}`;

export type SocialStatus = 'posted' | 'dry_run' | 'skipped' | 'failed' | 'unknown';

export interface SocialPostResult {
  platform: SocialPlatform;
  /** posted: live. dry_run: platform not live, nothing sent. skipped: a rule said no. failed: not live. unknown: may be live. */
  status: SocialStatus;
  reason?: string;
  /** Exactly what was, or would have been, posted: the disclosure line included. */
  text: string;
  url?: string;
  /** This platform's posts today (live, unknown and dry runs), this one included, against the cap. */
  used_today: number;
  daily_cap: number;
}

/** What a publisher reports. failed means certainly not live; unknown means it may be live. */
export type PublishOutcome =
  | { status: 'posted'; postId: string | null; url: string | null }
  | { status: 'failed'; reason: string }
  | { status: 'unknown'; reason: string; postId?: string | null };

/** Puts a post on Operis's account on one platform. Never throws: every problem is a failed or unknown outcome. */
export interface SocialPublisher {
  /** Stored with each post it handles, e.g. 'zernio'. */
  readonly name: string;
  /** `attemptId` is unique to this attempt, so a provider can make its own retries safe with it. */
  publish(post: { platform: SocialPlatform; text: string; attemptId: string }): Promise<PublishOutcome>;
}

/** Statuses that are, or may be, a public post (or a dry run of one): they count for the cap, the gap and repeats. */
const COUNTS: ReadonlySet<SocialPostStatus> = new Set(['pending', 'posted', 'unknown', 'dry_run']);
/** No repeat or near-repeat of a post on the same platform within this many days. */
export const REPEAT_DAYS = 30;
/** Links may point only here (or a subdomain), so nothing the agent read on the web can put its link in our posts. */
const LINK_HOSTS = ['operis.live'];
const MAX_LINKS = 1;
/** Posts on one platform at least this far apart: Meta's spam rules single out high-frequency posting. */
const MIN_GAP_MS = 60 * 60_000;
/** A post sharing at least this share of its distinct words with an earlier one (Jaccard) is a near-repeat. */
const NEAR_REPEAT = 0.6;

const NOT_CONFIGURED = 'not_configured: set ZERNIO_API_KEY and the ZERNIO_<PLATFORM>_ACCOUNT_ID of this platform';

// ---------- the text ----------

/** Control, zero-width and bidi-override characters (not the emoji joiner U+200D): never needed, and they defeat the repeat check. */
const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
/** An @handle: an @ not inside a word, so an email address is not a mention. */
const MENTION = /(?<![\p{L}\p{N}_@.])@[A-Za-z0-9_]/u;
/**
 * Links: http(s) URLs, plus bare domains on common TLDs (the platforms link "example.com" too). Not inside an email
 * address or a path. "Next.js" or "SKILL.md" are not links: .js and .md are not on the list.
 */
const LINK =
  /https?:\/\/[^\s<>"']+|(?<![@\w.\-/:])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:live|com|net|org|io|ai|dev|app|co|xyz|sh|me|gg|ly|so|to|tv|fm|link|site|online|tech|info|biz|us|uk|ca|de|eu|fr|cloud|page|blog|news|shop|store|club|top|vip|win|money|click)\b(?:\/[^\s<>"']*)?/giu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

interface Link {
  url: string;
  index: number;
}

interface Draft {
  /** The cleaned text the agent wrote, without the disclosure. */
  body: string;
  /** What is posted: body, a blank line, the disclosure. */
  text: string;
  links: Link[];
  /** Lowercase words without links or punctuation: what the repeat checks compare. */
  words: string[];
  hash: string;
}

const fold = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'");

function clean(raw: string): string {
  let t = raw.normalize('NFC').replace(/\r\n?/g, '\n').replace(INVISIBLE, '');
  t = t
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // The code adds the disclosure; drop one the agent added itself.
  if (fold(t).endsWith(fold(DISCLOSURE))) t = t.slice(0, t.length - DISCLOSURE.length).trimEnd();
  return t;
}

function findLinks(text: string): Link[] {
  return [...text.matchAll(LINK)].map((m) => ({ url: m[0].replace(TRAILING_PUNCTUATION, ''), index: m.index }));
}

function withoutLinks(text: string, links: Link[]): string {
  let out = '';
  let at = 0;
  for (const l of links) {
    out += text.slice(at, l.index);
    at = l.index + l.url.length;
  }
  return out + text.slice(at);
}

function draftOf(raw: string): Draft {
  const body = clean(raw);
  const links = findLinks(body);
  const words = withoutLinks(body, links).normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return { body, text: body ? body + TAIL : DISCLOSURE, links, words, hash: createHash('sha256').update(words.join(' ')).digest('hex') };
}

function allowedLink(url: string): boolean {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
    return LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const SEGMENTER = new Intl.Segmenter('en', { granularity: 'grapheme' });
const graphemes = (s: string) => Array.from(SEGMENTER.segment(s), (g) => g.segment);
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const utf8 = (s: string) => Buffer.byteLength(s, 'utf8');

/** twitter-text v3 (github.com/twitter/twitter-text config/v3.json): these code points weigh 1, every other one 2. */
const X_LIGHT: [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];
const xWeight = (cp: number) => (X_LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2);

/** Each platform's limit, counted its way, on the posted text (disclosure included). Never undercounts. */
const LIMITS: Record<SocialPlatform, (d: Draft) => string | null> = {
  // docs.x.com/fundamentals/counting-characters: 280, NFC; every URL 23 (t.co); an emoji (a whole sequence) 2.
  x: (d) => {
    let n = d.links.length * 23;
    for (const g of graphemes(withoutLinks(d.body, d.links) + TAIL)) {
      n += EMOJI.test(g) ? 2 : Array.from(g).reduce((w, ch) => w + xWeight(ch.codePointAt(0)!), 0);
    }
    return n > 280 ? `too_long: ${n} of 280 on x, the disclosure line included (a link counts 23, an emoji 2)` : null;
  },
  // developers.facebook.com/docs/threads/posts: 500 characters; "Emojis are counted as the number of UTF-8 bytes".
  threads: (d) => {
    const n = graphemes(d.text).reduce((sum, g) => sum + (EMOJI.test(g) ? utf8(g) : 1), 0);
    return n > 500 ? `too_long: ${n} of 500 on threads, the disclosure line included (an emoji counts its UTF-8 bytes, usually 4)` : null;
  },
  // atproto lexicon app.bsky.feed.post: text maxGraphemes 300, maxLength 3000 (UTF-8 bytes).
  bluesky: (d) => {
    const n = graphemes(d.text).length;
    if (n > 300) return `too_long: ${n} of 300 graphemes on bluesky, the disclosure line included`;
    const bytes = utf8(d.text);
    return bytes > 3000 ? `too_long: ${bytes} of 3000 bytes on bluesky, the disclosure line included` : null;
  },
};

/** What is wrong with the text itself, as "code: detail", or null. */
function textProblem(platform: SocialPlatform, d: Draft): string | null {
  if (!d.body) return 'empty: write the post (the code adds the disclosure line)';
  if (MENTION.test(d.body)) return 'mentions_not_allowed: no @mentions; never mention or tag anyone';
  if (d.links.length > MAX_LINKS) return `too_many_links: ${d.links.length} links; at most ${MAX_LINKS}, to https://operis.live`;
  const bad = d.links.find((l) => !allowedLink(l.url));
  if (bad) return `link_not_allowed: ${bad.url.slice(0, 80)}; links may point only to operis.live`;
  return LIMITS[platform](d);
}

// ---------- the rules ----------

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  const either = a.size + b.size - both;
  return either === 0 ? 0 : both / either;
}

/** An earlier post on this platform (counted, newest first) that this one repeats or nearly repeats, as a refusal. */
function repeatOf(platform: SocialPlatform, d: Draft, history: SocialPost[]): string | null {
  const exact = history.find((p) => p.body_hash === d.hash);
  if (exact) return `duplicate: the same words as the ${platform} post of ${pacificDate(exact.created_at)}; nothing is repeated within ${REPEAT_DAYS} days, write something new`;
  const mine = new Set(d.words);
  for (const p of history) {
    const share = jaccard(mine, new Set(draftOf(p.body).words));
    if (share >= NEAR_REPEAT) {
      return `near_duplicate: ${Math.round(share * 100)}% the same words as the ${platform} post of ${pacificDate(p.created_at)}; write something new, not a rewording`;
    }
  }
  return null;
}

/**
 * The first rule this post breaks, as "code: detail", or null. Stop signals first (paused, daily_cap, too_soon), then
 * the text (empty, mentions, links, length), then repeats. `history` is this platform's counted posts, newest first.
 */
function refusal(env: GrowthEnv, platform: SocialPlatform, d: Draft, history: SocialPost[], now: Date): string | null {
  if (env.GROWTH_SOCIAL_PAUSE || env.GROWTH_PAUSE) return 'paused: GROWTH_SOCIAL_PAUSE or GROWTH_PAUSE is on';
  const today = history.filter((p) => p.created_at >= pacificDayStart(now)).length;
  if (today >= env.GROWTH_SOCIAL_DAILY_CAP) return `daily_cap: ${today} of ${env.GROWTH_SOCIAL_DAILY_CAP} posts on ${platform} today (Pacific time); post again tomorrow`;
  const sinceLast = history[0] ? now.getTime() - history[0].created_at.getTime() : Infinity;
  if (sinceLast < MIN_GAP_MS) return `too_soon: the last ${platform} post was ${Math.floor(sinceLast / 60_000)} minutes ago; posts are at least 60 minutes apart`;
  return textProblem(platform, d) ?? repeatOf(platform, d, history);
}

export async function postSocial(deps: GrowthDeps, input: { platform: SocialPlatform; text: string }): Promise<SocialPostResult> {
  const { env, repo } = deps;
  const { platform } = input;
  const now = deps.now();
  const d = draftOf(input.text);
  const history = (await repo.socialPostsSince(platform, new Date(now.getTime() - REPEAT_DAYS * DAY_MS))).filter((p) => COUNTS.has(p.status));
  const usedBefore = history.filter((p) => p.created_at >= pacificDayStart(now)).length;
  const result = (status: SocialStatus, extra: { reason?: string; url?: string } = {}): SocialPostResult => ({
    platform,
    status,
    ...extra,
    text: d.text,
    used_today: usedBefore + (COUNTS.has(status) ? 1 : 0),
    daily_cap: env.GROWTH_SOCIAL_DAILY_CAP,
  });
  const log = (status: SocialPostStatus, reason: string | null = null) => repo.logSocialPost({ platform, status, reason, body: d.text, body_hash: d.hash });

  const refused = refusal(env, platform, d, history, now);
  if (refused) {
    await log('skipped', refused);
    return result('skipped', { reason: refused });
  }
  if (!env.GROWTH_SOCIAL_LIVE.includes(platform)) {
    await log('dry_run');
    return result('dry_run');
  }

  // Logged before publishing, so an attempt that dies mid-call still counts as maybe-posted.
  const id = await log('pending');
  const out: PublishOutcome = deps.social ? await deps.social.publish({ platform, text: d.text, attemptId: id }) : { status: 'failed', reason: NOT_CONFIGURED };
  const provider = deps.social?.name ?? null;
  if (out.status === 'posted') {
    await repo.settleSocialPost(id, { status: 'posted', provider, provider_post_id: out.postId, url: out.url });
    return result('posted', out.url ? { url: out.url } : {});
  }
  await repo.settleSocialPost(id, { status: out.status, reason: out.reason, provider, provider_post_id: out.status === 'unknown' ? (out.postId ?? null) : null });
  return result(out.status, { reason: out.reason });
}
