/**
 * Zernio (docs.zernio.com) as post_social's publisher. Zernio holds the platform tokens; Operis sends only the text and
 * an account id, server-side, with ZERNIO_API_KEY. One text post per call: POST /v1/posts with publishNow, so the
 * answer says whether it is live.
 *
 * No AI label is set: Zernio documents none for Threads (platforms/threads/posts lists topic_tag, firstComment and
 * threadItems only) or Bluesky, and X's madeWithAi "is for AI-generated images and video, not AI-written text"
 * (platforms/twitter/fields). social.ts's DISCLOSURE line is the disclosure on every platform.
 */
import type { PublishOutcome, SocialPublisher } from './social.js';
import type { SocialPlatform } from './types.js';

const API = 'https://zernio.com/api/v1';

/** Zernio's platform values (docs.zernio.com/platforms/twitter/posts: "platform value twitter"). */
const ZERNIO_PLATFORM: Record<SocialPlatform, string> = { x: 'twitter', threads: 'threads', bluesky: 'bluesky' };

export interface ZernioConfig {
  apiKey: string;
  /** Operis's own account on each platform, as Zernio's account _id. No other account is ever posted to. */
  accounts: Partial<Record<SocialPlatform, string>>;
  /** Tests pass a fake HTTP client; production uses the global fetch. */
  fetch?: typeof fetch;
  /** Per attempt. Two attempts at most, so one call stays inside the internal MCP route's 60 s. */
  timeoutMs?: number;
  retryDelayMs?: number;
}

type Answer = { kind: 'http'; status: number; body: any } | { kind: 'unreachable'; message: string };

const short = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 300);

/** Zernio's error envelope (guides/error-handling): `error` is the message, `type` and `code` are stable. */
function errorText(status: number, body: any): string {
  const tag = [body?.type, body?.code].filter(Boolean).join('/');
  return `zernio ${status}${tag ? ` ${tag}` : ''}: ${typeof body?.error === 'string' ? body.error : 'no message'}`;
}

/** Worth one retry with the same Idempotency-Key: a timeout, a dropped connection, a 5xx, or the first try still running. */
const retryable = (a: Answer) => a.kind === 'unreachable' || a.status >= 500 || (a.status === 409 && a.body?.code === 'idempotency_conflict');

export class ZernioPublisher implements SocialPublisher {
  readonly name = 'zernio';

  constructor(private readonly cfg: ZernioConfig) {}

  async publish(post: { platform: SocialPlatform; text: string; attemptId: string }): Promise<PublishOutcome> {
    const accountId = this.cfg.accounts[post.platform];
    if (!accountId) return { status: 'failed', reason: `not_configured: set ZERNIO_${post.platform.toUpperCase()}_ACCOUNT_ID (the account's _id in Zernio)` };
    const request = { content: post.text, platforms: [{ platform: ZERNIO_PLATFORM[post.platform], accountId }], publishNow: true };
    // guides/idempotency: the same key on a retry "returns the original instead of a duplicate".
    let answer = await this.send(request, post.attemptId);
    if (retryable(answer)) {
      await new Promise((r) => setTimeout(r, this.cfg.retryDelayMs ?? 1000));
      answer = await this.send(request, post.attemptId);
    }
    return outcome(answer, ZERNIO_PLATFORM[post.platform]);
  }

  private async send(request: unknown, idempotencyKey: string): Promise<Answer> {
    try {
      const res = await (this.cfg.fetch ?? fetch)(`${API}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 20_000),
      });
      const text = await res.text();
      let body: any = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { error: text.slice(0, 200) };
      }
      return { kind: 'http', status: res.status, body };
    } catch (e) {
      return { kind: 'unreachable', message: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** What Zernio's answer means for this post (posts/create-post, guides/post-lifecycle, guides/idempotency). */
function outcome(a: Answer, platform: string): PublishOutcome {
  if (a.kind === 'unreachable') return { status: 'unknown', reason: short(`zernio unreachable: ${a.message}; the post may be live, check the account`) };
  const { status, body } = a;
  const post = body?.post;
  const postId: string | null = typeof post?._id === 'string' ? post._id : null;
  if (status >= 500) return { status: 'unknown', reason: short(`${errorText(status, body)}; the post may be live, check the account`), postId };
  if (status === 409) {
    if (body?.code === 'idempotency_conflict') return { status: 'unknown', reason: short(`${errorText(status, body)}; the post may be live, check the account`), postId };
    return { status: 'failed', reason: short(`duplicate_content: Zernio says this text went to this account in the last 24 hours (${body?.error ?? '409'})`) };
  }
  if (status === 202) {
    return { status: 'unknown', reason: "x_awaiting_funds: Zernio's balance is $0; X gets the post once it is funded, or it fails after 24 hours", postId };
  }
  if (status !== 200 && status !== 201 && status !== 207) return { status: 'failed', reason: short(errorText(status, body)) };

  // 200 (an idempotent replay), 201 (created) and 207 (created, publishing did not fully succeed): the platform entry decides.
  const entry = (post?.platforms ?? []).find((p: any) => p?.platform === platform) ?? post?.platforms?.[0];
  const entryStatus: string | undefined = entry?.status ?? post?.status;
  if (entryStatus === 'published') return { status: 'posted', postId, url: typeof entry?.platformPostUrl === 'string' ? entry.platformPostUrl : null };
  if (entryStatus === 'failed' || entryStatus === 'cancelled') {
    const result = (body?.platformResults ?? []).find((r: any) => r?.platform === platform);
    return { status: 'failed', reason: short(`zernio: ${entry?.errorMessage ?? result?.error ?? body?.error ?? `publishing ${entryStatus}`}`) };
  }
  return { status: 'unknown', reason: short(`zernio: post ${postId ?? '(no id)'} is ${entryStatus ?? 'in an unknown state'}; check the account before posting it again`), postId };
}
