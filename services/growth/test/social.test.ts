import { describe, expect, it } from 'vitest';
import type { GrowthEnv } from '../src/env.js';
import { DISCLOSURE, postSocial } from '../src/social.js';
import { ZernioPublisher } from '../src/zernio.js';
import { setup } from './helpers.js';

/** A fake HTTP client in place of fetch: records every request and answers from a queue (an Error is thrown). */
function fakeHttp(...answers: (Response | Error)[]) {
  const requests: { url: string; method: string; headers: Record<string, string>; body: any }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    requests.push({ url: String(url), method: init?.method ?? 'GET', headers, body: init?.body ? JSON.parse(String(init.body)) : null });
    const next = answers.shift();
    if (!next) throw new Error('fake http: no answer queued');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const published = (platform: string, url: string) =>
  json(201, { post: { _id: 'zp_1', status: 'published', platforms: [{ platform, status: 'published', platformPostId: '185', platformPostUrl: url }] } });

const ACCOUNTS = { x: 'acc_x', threads: 'acc_t', bluesky: 'acc_b' };

/** Growth deps whose post_social goes through the real ZernioPublisher over the fake HTTP client. */
function social(env: Partial<GrowthEnv> = {}, ...answers: (Response | Error)[]) {
  const s = setup(env);
  const http = fakeHttp(...answers);
  s.deps.social = new ZernioPublisher({ apiKey: 'sk_test', accounts: ACCOUNTS, fetch: http.fetch, retryDelayMs: 0 });
  return { ...s, http };
}

const withDisclosure = (text: string) => `${text}\n\n${DISCLOSURE}`;

describe('post_social: the flow', () => {
  it('dry-runs by default: checked and logged with the disclosure line, nothing sent', async () => {
    const s = social();
    const r = await postSocial(s.deps, { platform: 'x', text: 'Your agent can hire a person in SF. https://operis.live' });
    expect(r).toEqual({ platform: 'x', status: 'dry_run', text: withDisclosure('Your agent can hire a person in SF. https://operis.live'), used_today: 1, daily_cap: 3 });
    expect(s.http.requests).toHaveLength(0);
    expect(s.repo.socialPosts.map((p) => [p.platform, p.status, p.body])).toEqual([['x', 'dry_run', r.text]]);
  });

  it("posts a live platform through Zernio: one POST /v1/posts with the key, an idempotency key and Operis's account", async () => {
    const s = social({ GROWTH_SOCIAL_LIVE: ['x'] }, published('twitter', 'https://twitter.com/operis/status/185'));
    const r = await postSocial(s.deps, { platform: 'x', text: 'Your agent can hire a person in SF.' });
    expect(r).toEqual({
      platform: 'x',
      status: 'posted',
      text: withDisclosure('Your agent can hire a person in SF.'),
      url: 'https://twitter.com/operis/status/185',
      used_today: 1,
      daily_cap: 3,
    });
    expect(s.http.requests).toHaveLength(1);
    const req = s.http.requests[0]!;
    expect([req.method, req.url]).toEqual(['POST', 'https://zernio.com/api/v1/posts']);
    expect(req.headers.authorization).toBe('Bearer sk_test');
    expect(req.headers['idempotency-key']).toBe(s.repo.socialPosts[0]!.id);
    expect(req.body).toEqual({ content: r.text, platforms: [{ platform: 'twitter', accountId: 'acc_x' }], publishNow: true });
    expect(s.repo.socialPosts).toHaveLength(1);
    expect(s.repo.socialPosts[0]).toMatchObject({ status: 'posted', provider: 'zernio', provider_post_id: 'zp_1', url: 'https://twitter.com/operis/status/185' });
  });

  it("names Threads and Bluesky as Zernio does and posts each only to Operis's account there", async () => {
    const s = social(
      { GROWTH_SOCIAL_LIVE: ['threads', 'bluesky'] },
      published('threads', 'https://www.threads.net/@operis/post/1'),
      published('bluesky', 'https://bsky.app/profile/operis.live/post/1'),
    );
    expect((await postSocial(s.deps, { platform: 'threads', text: 'Real people for real-world tasks.' })).status).toBe('posted');
    expect((await postSocial(s.deps, { platform: 'bluesky', text: 'Real people for real-world tasks.' })).status).toBe('posted');
    expect(s.http.requests.map((r) => r.body.platforms)).toEqual([[{ platform: 'threads', accountId: 'acc_t' }], [{ platform: 'bluesky', accountId: 'acc_b' }]]);
  });

  it('the kill switch (GROWTH_SOCIAL_PAUSE, or GROWTH_PAUSE for all growth) skips every call and logs it', async () => {
    for (const pause of [{ GROWTH_SOCIAL_PAUSE: true }, { GROWTH_PAUSE: true }]) {
      const s = social({ GROWTH_SOCIAL_LIVE: ['x'], ...pause });
      const r = await postSocial(s.deps, { platform: 'x', text: 'Hello from Operis.' });
      expect(r).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/^paused/), used_today: 0 });
      expect(s.http.requests).toHaveLength(0);
      expect(s.repo.socialPosts.map((p) => p.status)).toEqual(['skipped']);
    }
  });

  it('a live platform with no Zernio key or no account fails as not_configured and is not counted', async () => {
    const none = setup({ GROWTH_SOCIAL_LIVE: ['x'] });
    expect(await postSocial(none.deps, { platform: 'x', text: 'Hello.' })).toMatchObject({ status: 'failed', reason: expect.stringMatching(/^not_configured: .*ZERNIO_API_KEY/), used_today: 0 });
    expect(none.repo.socialPosts.map((p) => p.status)).toEqual(['failed']);

    const s = social({ GROWTH_SOCIAL_LIVE: ['threads'] });
    s.deps.social = new ZernioPublisher({ apiKey: 'sk_test', accounts: { x: 'acc_x' }, fetch: s.http.fetch });
    expect(await postSocial(s.deps, { platform: 'threads', text: 'Hello.' })).toMatchObject({ status: 'failed', reason: expect.stringMatching(/^not_configured: .*ZERNIO_THREADS_ACCOUNT_ID/) });
    expect(s.http.requests).toHaveLength(0);
  });
});

describe('post_social: what a post may say', () => {
  const tryPost = async (platform: 'x' | 'threads' | 'bluesky', text: string) => {
    const s = social();
    return postSocial(s.deps, { platform, text });
  };
  const reasonOf = async (platform: 'x' | 'threads' | 'bluesky', text: string) => {
    const r = await tryPost(platform, text);
    return r.status === 'skipped' ? r.reason!.split(':')[0] : r.status;
  };

  it('refuses @mentions (no cold mentions); an email address is not a mention', async () => {
    expect(await reasonOf('x', 'Thanks @stranger for the idea!')).toBe('mentions_not_allowed');
    expect(await reasonOf('bluesky', '(@someone.bsky.social) agents can hire people now')).toBe('mentions_not_allowed');
    expect(await reasonOf('threads', 'Questions? Write to sales@operis.live')).toBe('dry_run');
  });

  it('allows one link, only to operis.live or its subdomains, bare or with https', async () => {
    expect(await reasonOf('x', 'Start here: https://operis.live/SKILL.md.')).toBe('dry_run');
    expect(await reasonOf('x', 'Add the MCP server: https://api.operis.live/mcp')).toBe('dry_run');
    expect(await reasonOf('threads', 'See operis.live for the MCP server')).toBe('dry_run');
    expect(await reasonOf('x', 'Built with Next.js and TypeScript; docs in SKILL.md')).toBe('dry_run');
    expect(await reasonOf('x', 'Two links: https://operis.live and https://operis.live/developers')).toBe('too_many_links');
    expect(await reasonOf('x', 'Look: https://evil.example/win')).toBe('link_not_allowed');
    expect(await reasonOf('threads', 'Look: free-money.com/now')).toBe('link_not_allowed');
    expect(await reasonOf('bluesky', 'Look: https://operis.live.evil.example')).toBe('link_not_allowed');
    expect(await reasonOf('bluesky', 'Look: https://operis.live@evil.example')).toBe('link_not_allowed');
  });

  it("counts X's way, the disclosure line included: 280 weighted, a link is 23, an emoji or a CJK character 2", async () => {
    const room = 280 - (2 + DISCLOSURE.length); // the blank line and the disclosure
    expect(await reasonOf('x', 'a'.repeat(room))).toBe('dry_run');
    expect(await reasonOf('x', 'a'.repeat(room + 1))).toBe('too_long');
    expect(await reasonOf('x', `${'a'.repeat(room - 24)} https://operis.live/a/long/path/that/is/far/longer/than/twenty/three`)).toBe('dry_run');
    expect(await reasonOf('x', `${'a'.repeat(room - 23)} https://operis.live`)).toBe('too_long');
    expect(await reasonOf('x', '😀'.repeat(room / 2))).toBe('dry_run');
    expect(await reasonOf('x', `${'😀'.repeat(room / 2)}a`)).toBe('too_long');
    expect(await reasonOf('x', '字'.repeat(room / 2 + 1))).toBe('too_long');
    const r = await tryPost('x', 'a'.repeat(room + 1));
    expect(r.reason).toBe('too_long: 281 of 280 on x, the disclosure line included (a link counts 23, an emoji 2)');
  });

  it('counts Threads its way (500, an emoji is its UTF-8 bytes) and Bluesky its way (300 graphemes, 3000 bytes)', async () => {
    const threadsRoom = 500 - (2 + DISCLOSURE.length);
    expect(await reasonOf('threads', 'a'.repeat(threadsRoom))).toBe('dry_run');
    expect(await reasonOf('threads', 'a'.repeat(threadsRoom + 1))).toBe('too_long');
    expect(await reasonOf('threads', '😀'.repeat(Math.floor(threadsRoom / 4)))).toBe('dry_run');
    expect(await reasonOf('threads', '😀'.repeat(Math.floor(threadsRoom / 4) + 1))).toBe('too_long');
    const blueskyRoom = 300 - (2 + DISCLOSURE.length);
    expect(await reasonOf('bluesky', 'a'.repeat(blueskyRoom))).toBe('dry_run');
    expect(await reasonOf('bluesky', 'a'.repeat(blueskyRoom + 1))).toBe('too_long');
    expect(await reasonOf('bluesky', '😀'.repeat(blueskyRoom))).toBe('dry_run');
    expect(await reasonOf('bluesky', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}'.repeat(119))).toBe('too_long'); // 119 graphemes but 2,975 bytes + the disclosure
  });

  it('strips invisible and control characters, keeps one disclosure line, and refuses an empty post', async () => {
    const r = await tryPost('x', ' Real\u200B people,\u202E real\u0007 tasks.\r\n\r\n\r\n\r\nPay on proof.\n\nWritten and posted by Operis’s AI agent. ');
    expect(r.text).toBe(withDisclosure('Real people, real tasks.\n\nPay on proof.'));
    expect(await reasonOf('x', ' \u200B\n ')).toBe('empty');
  });
});

describe('post_social: how often, and never twice', () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const post = (s: ReturnType<typeof social>, platform: 'x' | 'threads' | 'bluesky', text: string) => postSocial(s.deps, { platform, text });

  it('allows daily_cap posts per platform per Pacific day, dry runs included; each platform counts on its own', async () => {
    const s = social();
    const texts = ['Agents can now hire a person in San Francisco.', 'Pay only when the proof passes: photos, GPS and time.', 'Notaries, deliveries, venue checks: real tasks, real people.'];
    for (const [i, text] of texts.entries()) {
      expect(await post(s, 'x', text)).toMatchObject({ status: 'dry_run', used_today: i + 1, daily_cap: 3 });
      s.advance(61 * MIN);
    }
    expect(await post(s, 'x', 'Hackathon teams get their first job free.')).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/^daily_cap/), used_today: 3 });
    expect(await post(s, 'threads', 'Hackathon teams get their first job free.')).toMatchObject({ status: 'dry_run', used_today: 1 });
    s.advance(21 * HOUR); // Mon Nov 9, Pacific: a new day
    expect(await post(s, 'x', 'Hackathon teams get their first job free.')).toMatchObject({ status: 'dry_run', used_today: 1 });
  });

  it('a daily cap of 0 turns posting off', async () => {
    const s = social({ GROWTH_SOCIAL_DAILY_CAP: 0 });
    expect(await post(s, 'bluesky', 'Agents can now hire a person in San Francisco.')).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/^daily_cap/) });
  });

  it('keeps posts on one platform at least 60 minutes apart; other platforms are not held back', async () => {
    const s = social();
    await post(s, 'x', 'Agents can now hire a person in San Francisco.');
    s.advance(59 * MIN);
    expect(await post(s, 'x', 'Pay only when the proof passes: photos, GPS and time.')).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/^too_soon/) });
    expect((await post(s, 'bluesky', 'Pay only when the proof passes: photos, GPS and time.')).status).toBe('dry_run');
    s.advance(1 * MIN);
    expect((await post(s, 'x', 'Pay only when the proof passes: photos, GPS and time.')).status).toBe('dry_run');
  });

  it('refuses a repeat: the same words, whatever the case, punctuation, spacing or link', async () => {
    const s = social();
    await post(s, 'x', 'Your agent can hire a real person in SF. https://operis.live');
    s.advance(2 * HOUR);
    expect(await post(s, 'x', 'your agent can hire a REAL person in SF!!   operis.live/SKILL.md')).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/^duplicate/) });
    expect(s.repo.socialPosts.map((p) => p.body_hash)).toEqual([s.repo.socialPosts[0]!.body_hash, s.repo.socialPosts[0]!.body_hash]);
  });

  it('refuses a near-repeat (mostly the same words) on that platform for 30 days', async () => {
    const s = social();
    await post(s, 'x', 'Your agent can hire a person in SF to check a place, with photo and GPS proof.');
    s.advance(2 * HOUR);
    const near = 'Your agent can hire a person in SF to check a venue, with photo and GPS proof.';
    expect(await post(s, 'x', near)).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/^near_duplicate/) });
    expect((await post(s, 'threads', near)).status).toBe('dry_run');
    expect((await post(s, 'x', 'Hackathon teams: your first job on Operis is free, up to $25.')).status).toBe('dry_run');
    s.advance(31 * 24 * HOUR);
    expect((await post(s, 'x', near)).status).toBe('dry_run');
  });

  it('logs every call once: skips, dry runs and posts, with the text that was or would have been posted', async () => {
    const s = social();
    await post(s, 'x', 'Agents can now hire a person in San Francisco.');
    await post(s, 'x', 'Thanks @stranger!');
    await post(s, 'x', 'Agents can now hire a person in San Francisco.');
    expect(s.repo.socialPosts.map((p) => [p.status, p.reason?.split(':')[0] ?? null, p.body])).toEqual([
      ['dry_run', null, withDisclosure('Agents can now hire a person in San Francisco.')],
      ['skipped', 'too_soon', withDisclosure('Thanks @stranger!')],
      ['skipped', 'too_soon', withDisclosure('Agents can now hire a person in San Francisco.')],
    ]);
  });
});

describe('post_social: what Zernio answers', () => {
  const live = (...answers: (Response | Error)[]) => social({ GROWTH_SOCIAL_LIVE: ['x'] }, ...answers);
  const TEXT = 'Agents can now hire a person in San Francisco.';
  const HOUR = 3_600_000;

  it('207, publishing failed: failed with the platform error, not counted, so the text may be tried again', async () => {
    const s = live(
      json(207, {
        message: 'Post created but publishing failed',
        error: 'All platforms failed',
        post: { _id: 'zp_2', status: 'failed', platforms: [{ platform: 'twitter', status: 'failed', errorMessage: 'Tweet text is too long (312 characters).' }] },
      }),
      published('twitter', 'https://twitter.com/operis/status/186'),
    );
    expect(await postSocial(s.deps, { platform: 'x', text: TEXT })).toMatchObject({ status: 'failed', reason: 'zernio: Tweet text is too long (312 characters).', used_today: 0 });
    expect(await postSocial(s.deps, { platform: 'x', text: TEXT })).toMatchObject({ status: 'posted', used_today: 1 });
    expect(s.repo.socialPosts.map((p) => p.status)).toEqual(['failed', 'posted']);
  });

  it('a 4xx is a failure with its status, type and code, never the key', async () => {
    const s = live(
      json(401, { error: 'The key is invalid', type: 'authentication_error', code: 'invalid_credentials' }),
      json(403, { error: 'Account disconnected', type: 'invalid_request_error', code: 'ACCOUNT_DISCONNECTED' }),
      json(409, { error: 'This exact content is already scheduled, publishing, or was posted to this account within the last 24 hours.', details: { existingPostId: 'zp_0' } }),
    );
    const a = await postSocial(s.deps, { platform: 'x', text: TEXT });
    expect(a).toMatchObject({ status: 'failed', reason: 'zernio 401 authentication_error/invalid_credentials: The key is invalid' });
    expect(JSON.stringify(a)).not.toContain('sk_test');
    expect(await postSocial(s.deps, { platform: 'x', text: TEXT })).toMatchObject({ status: 'failed', reason: expect.stringMatching(/^zernio 403 .*ACCOUNT_DISCONNECTED/) });
    expect(await postSocial(s.deps, { platform: 'x', text: TEXT })).toMatchObject({ status: 'failed', reason: expect.stringMatching(/^duplicate_content: /) });
    expect(s.http.requests).toHaveLength(3);
  });

  it('202 (X held until the Zernio balance is funded) may still go out: unknown, and it counts', async () => {
    const s = live(json(202, { message: 'Waiting for funds', post: { _id: 'zp_3', status: 'scheduled', platforms: [{ platform: 'twitter', status: 'pending' }] } }));
    expect(await postSocial(s.deps, { platform: 'x', text: TEXT })).toMatchObject({ status: 'unknown', reason: expect.stringMatching(/^x_awaiting_funds/), used_today: 1 });
    expect(s.repo.socialPosts[0]).toMatchObject({ status: 'unknown', provider_post_id: 'zp_3' });
  });

  it('a timeout is retried once with the same idempotency key; Zernio replays the original post', async () => {
    const s = live(new Error('The operation was aborted due to timeout'), json(200, {
      message: 'Post already exists (idempotent retry)',
      post: { _id: 'zp_4', status: 'published', platforms: [{ platform: 'twitter', status: 'published', platformPostUrl: 'https://twitter.com/operis/status/187' }] },
    }));
    expect(await postSocial(s.deps, { platform: 'x', text: TEXT })).toMatchObject({ status: 'posted', url: 'https://twitter.com/operis/status/187' });
    const keys = s.http.requests.map((r) => r.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('two 5xx (or an idempotency conflict and a 5xx): unknown, counted, and the same text is refused as a repeat', async () => {
    const s = live(json(503, { error: 'Upstream down', type: 'api_error', code: 'temporarily_unavailable' }), json(500, { error: 'boom', type: 'api_error' }));
    expect(await postSocial(s.deps, { platform: 'x', text: TEXT })).toMatchObject({ status: 'unknown', reason: expect.stringMatching(/^zernio 500 .*may be live/), used_today: 1 });
    expect(s.http.requests).toHaveLength(2);
    s.advance(2 * HOUR);
    expect(await postSocial(s.deps, { platform: 'x', text: TEXT })).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/^duplicate/) });

    const t = live(json(409, { error: 'Still processing', type: 'invalid_request_error', code: 'idempotency_conflict' }), new Error('socket hang up'));
    expect(await postSocial(t.deps, { platform: 'x', text: TEXT })).toMatchObject({ status: 'unknown', reason: expect.stringMatching(/^zernio unreachable: socket hang up.*may be live/) });
  });

  it('201 while the platform is still processing: unknown with the Zernio post id', async () => {
    const s = live(json(201, { post: { _id: 'zp_5', status: 'publishing', platforms: [{ platform: 'twitter', status: 'processing' }] } }));
    expect(await postSocial(s.deps, { platform: 'x', text: TEXT })).toMatchObject({ status: 'unknown', reason: expect.stringMatching(/zp_5 is processing/) });
  });
});
