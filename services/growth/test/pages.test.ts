import { describe, expect, it } from 'vitest';
import { decide } from '../src/guard.js';
import { signLink } from '../src/links.js';
import { joinAction, joinPage, unsubscribePage, type PageResult } from '../src/pages.js';
import { DAY_MS } from '../src/time.js';
import { NOW, SECRET, recruitContact, setup } from './helpers.js';

const html = (r: PageResult) => ('html' in r ? r.html : '');

describe('join link', () => {
  it('GET changes nothing; opt_in makes a regular; identity redirects to Stripe', async () => {
    const s = setup();
    const c = await recruitContact(s, 'ada@devs.example');
    const t = signLink(SECRET, 'join', c.id, NOW);
    const get = await joinPage(s.deps, t);
    expect(get).toMatchObject({ status: 200 });
    expect(html(get)).toContain('Yes, send me jobs');
    expect(s.pool.people.get(c.worker_id!)!.regular).toBe(false);

    const joined = await joinAction(s.deps, t, 'opt_in');
    expect(html(joined)).toContain('Verify my ID');
    expect(s.pool.people.get(c.worker_id!)!.regular).toBe(true);
    expect((await s.repo.getContact(c.id))!.joined_at).toEqual(NOW);

    expect(await joinAction(s.deps, t, 'identity')).toEqual({ redirect: `https://verify.stripe.test/${c.worker_id}` });
    expect(s.identityCalls).toEqual([c.worker_id]);
  });

  it('asks to join before the ID check and refuses tampered or expired links', async () => {
    const s = setup();
    const c = await recruitContact(s, 'ada@devs.example');
    const t = signLink(SECRET, 'join', c.id, NOW);
    expect(await joinAction(s.deps, t, 'identity')).toMatchObject({ status: 409 });
    expect(await joinPage(s.deps, `${t}x`)).toMatchObject({ status: 400 });
    s.advance(31 * DAY_MS);
    expect(await joinAction(s.deps, t, 'opt_in')).toMatchObject({ status: 400 });
    expect(s.pool.people.get(c.worker_id!)!.regular).toBe(false);
  });
});

describe('unsubscribe link', () => {
  it('one click opts out of growth and Ops outreach; later invites and joins are refused', async () => {
    const s = setup();
    const c = await recruitContact(s, 'ada@devs.example');
    const r = await unsubscribePage(s.deps, signLink(SECRET, 'unsubscribe', c.id, NOW));
    expect(r).toMatchObject({ status: 200 });
    expect(html(r)).toContain("You're unsubscribed");
    expect(s.pool.people.get(c.worker_id!)!.opted_out).toBe(true);
    expect(await decide(s.deps, 'invite', 'ada@devs.example')).toEqual({ action: 'skip', reason: 'opted_out' });
    const join = await joinAction(s.deps, signLink(SECRET, 'join', c.id, NOW), 'opt_in');
    expect(html(join)).toContain('You unsubscribed');
    expect(s.pool.people.get(c.worker_id!)!.regular).toBe(false);
  });

  it('still works years later, and a broken link offers a way out', async () => {
    const s = setup();
    const c = await recruitContact(s, 'ada@devs.example');
    const t = signLink(SECRET, 'unsubscribe', c.id, NOW);
    s.advance(3 * 365 * DAY_MS);
    expect(await unsubscribePage(s.deps, t)).toMatchObject({ status: 200 });
    const bad = await unsubscribePage(s.deps, 'u.nope');
    expect(bad).toMatchObject({ status: 400 });
    expect(html(bad)).toContain('ops@operis.live');
  });
});
