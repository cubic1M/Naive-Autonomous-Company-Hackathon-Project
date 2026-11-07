import { describe, expect, it } from 'vitest';
import { classifyReply, handleReply, stripQuoted } from '../src/replies.js';
import { InMemoryRepo } from '../src/repo/memory.js';

const c = (t: string) => classifyReply(t);

describe('classifyReply', () => {
  it.each(['STOP', 'stop', ' Stop. ', 'STOPALL', 'unsubscribe', 'Cancel', 'END', 'quit', 'please remove me', "Don't contact me", 'do not contact me again', 'opt out'])(
    'stop: %s', (t) => expect(c(t).intent).toBe('stop'));
  it('STOP wins', () => {
    expect(c('yes stop').intent).toBe('stop');
    expect(c('MORE jobs but STOP texting?').intent).toBe('stop');
    expect(c('no, unsubscribe me').intent).toBe('stop');
  });
  it('end/cancel inside a long sentence is not a stop', () => {
    expect(c('I can be there by the end of the day').intent).not.toBe('stop');
  });
  it('yes variants and code', () => {
    expect(c('YES')).toEqual({ intent: 'yes' });
    expect(c('y')).toEqual({ intent: 'yes' });
    expect(c('Yes!')).toEqual({ intent: 'yes' });
    expect(c('yes 4821')).toEqual({ intent: 'yes', code: '4821' });
    expect(c('Yes - 4821.')).toEqual({ intent: 'yes', code: '4821' });
    expect(c('yes A7K2')).toEqual({ intent: 'yes', code: 'A7K2' });
  });
  it('no variants', () => {
    expect(c('NO').intent).toBe('no');
    expect(c('No thanks').intent).toBe('no');
    expect(c("I'm not interested").intent).toBe('no');
  });
  it('more / sms_ok', () => {
    expect(c('MORE')).toEqual({ intent: 'more' });
    expect(c('more jobs').intent).toBe('more');
    expect(c('MORE TEXT OK')).toEqual({ intent: 'more', sms_ok: true });
    expect(c('TEXT OK')).toEqual({ intent: 'sms_ok' });
    expect(c('you can text me').intent).toBe('sms_ok');
  });
  it('question and unknown', () => {
    expect(c('Where exactly is this?').intent).toBe('question');
    expect(c('is it still available?').intent).toBe('question');
    expect(c('blah blah').intent).toBe('unknown');
    expect(c('').intent).toBe('unknown');
  });
  it('strips quoted history', () => {
    const t = 'YES 4821\n\nOn Sat, Nov 8, 2026 at 2:00 PM Operis <ops@x.com> wrote:\n> Reply STOP to never hear from us again.\n> Want more?';
    expect(c(t)).toEqual({ intent: 'yes', code: '4821' });
    expect(c('MORE\n> Reply STOP to never hear from us again.')).toEqual({ intent: 'more' });
    expect(stripQuoted('hi\n> quoted\nbye')).toBe('hi\nbye');
  });
});

describe('handleReply', () => {
  const setup = () => {
    const repo = new InMemoryRepo();
    const p = repo.addPerson({ dedupe_key: 'a', email: 'sam@x.com', phone: '+14155550142', kind: 'business' });
    return { repo, p };
  };
  it('stop opts out by email (angle-bracket from) and by phone', async () => {
    const { repo, p } = setup();
    const r = await handleReply({ channel: 'email', from: 'Sam <Sam@X.com>', text: 'yes stop' }, { repo });
    expect(r).toMatchObject({ intent: 'stop', action: 'opted_out', matched_people: 1, reply_text: "You're unsubscribed. We won't contact you again." });
    expect(repo.people.get(p.id)!.opted_out).toBe(true);
    const s = setup();
    const r2 = await handleReply({ channel: 'sms', from: '(415) 555-0142', text: 'STOP' }, { repo: s.repo });
    expect(r2.matched_people).toBe(1);
    expect(s.repo.people.get(s.p.id)!.opted_out).toBe(true);
  });
  it('more marks regular, with sms consent only when given', async () => {
    const { repo, p } = setup();
    let r = await handleReply({ channel: 'email', from: 'sam@x.com', text: 'MORE' }, { repo });
    expect(r).toMatchObject({ action: 'marked_regular', matched_people: 1 });
    expect(repo.people.get(p.id)).toMatchObject({ regular: true, sms_consent: false });
    r = await handleReply({ channel: 'email', from: 'sam@x.com', text: 'MORE TEXT OK' }, { repo });
    expect(r.sms_ok).toBe(true);
    expect(repo.people.get(p.id)!.sms_consent).toBe(true);
  });
  it('more from unknown sender goes to ops', async () => {
    const { repo } = setup();
    const r = await handleReply({ channel: 'email', from: 'who@x.com', text: 'MORE' }, { repo });
    expect(r).toMatchObject({ intent: 'more', action: 'forward_to_ops', matched_people: 0 });
  });
  it('yes, no, question, unknown', async () => {
    const { repo } = setup();
    const y = await handleReply({ channel: 'sms', from: '+14155550142', text: 'yes 4821' }, { repo });
    expect(y).toMatchObject({ action: 'accept_requested', code: '4821', matched_people: 1 });
    expect((await handleReply({ channel: 'sms', from: '+14155550142', text: 'no' }, { repo })).action).toBe('declined');
    expect((await handleReply({ channel: 'sms', from: '+14155550142', text: 'when?' }, { repo })).action).toBe('forward_to_ops');
    expect((await handleReply({ channel: 'sms', from: '+14155550142', text: 'hmm' }, { repo })).action).toBe('forward_to_ops');
  });
  it('uses injected findByContact', async () => {
    const { repo, p } = setup();
    const r = await handleReply({ channel: 'email', from: 'other@x.com', text: 'MORE' }, { repo, findByContact: async () => [p] });
    expect(r.matched_people).toBe(1);
    expect(repo.people.get(p.id)!.regular).toBe(true);
  });
});
