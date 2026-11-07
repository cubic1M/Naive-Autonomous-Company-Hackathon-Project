import { describe, expect, it } from 'vitest';
import { HttpMonid } from '../src/monid.js';

function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`;
    calls.push(key);
    const body = routes[key];
    if (body === undefined) return new Response('{"error":{"message":"no route"}}', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe('HttpMonid', () => {
  it('reads the real cost from the run record when the sync response has none', async () => {
    const { impl, calls } = fakeFetch({
      'POST /v1/run': { runId: 'r1', status: 'COMPLETED', providerResponse: { httpStatus: 200 }, output: { ok: 1 }, price: { amount: { value: 0.01 } } },
      'GET /v1/runs/r1': { runId: 'r1', status: 'COMPLETED', cost: { value: 0.0245 } },
    });
    const r = await new HttpMonid('k', 'https://api.example', impl, 1).run('hunterio', '/domain-search', { body: { domain: 'x.com' } });
    expect(r.cost_usd).toBe(0.0245);
    expect(r.output).toEqual({ ok: 1 });
    expect(calls).toEqual(['POST /v1/run', 'GET /v1/runs/r1']);
  });

  it('falls back to the price when the run record is unreachable', async () => {
    const { impl } = fakeFetch({
      'POST /v1/run': { runId: 'r2', status: 'COMPLETED', providerResponse: { httpStatus: 200 }, output: {}, price: { amount: { value: 0.001 } } },
    });
    const r = await new HttpMonid('k', 'https://api.example', impl, 1).run('search1api', '/crawl', { body: { url: 'https://a.com' } });
    expect(r.cost_usd).toBe(0.001);
  });

  it('polls until terminal and uses the cost on the final record', async () => {
    let n = 0;
    const impl = (async (url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ runId: 'r3', status: 'RUNNING' }), { status: 200 });
      n++;
      const done = n >= 2;
      return new Response(
        JSON.stringify({ runId: 'r3', status: done ? 'COMPLETED' : 'RUNNING', cost: done ? { value: 0.002 } : undefined, output: done ? [1] : null }),
        { status: 200 },
      );
    }) as typeof fetch;
    const r = await new HttpMonid('k', 'https://api.example', impl, 1).run('p', '/e', {});
    expect(r.status).toBe('COMPLETED');
    expect(r.cost_usd).toBe(0.002);
  });
});
