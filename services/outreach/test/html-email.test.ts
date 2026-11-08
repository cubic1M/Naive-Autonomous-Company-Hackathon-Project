import { describe, expect, it } from 'vitest';
import { sendBlast } from '../src/blast.js';
import { InMemoryRepo } from '../src/repo/memory.js';
import { RecordingSender } from '../src/senders.js';
import { makeEnv, makeJob } from './helpers/fakeMonid.js';

describe('send_blast sends the designed HTML email', () => {
  it('passes both the HTML and the plain-text version to the sender, with the job link on the button', async () => {
    const repo = new InMemoryRepo();
    repo.addJob(makeJob({ id: 'job1', status: 'held', title: 'Fix our Next.js deploy bug' }));
    const p = repo.addPerson({ dedupe_key: 'email:me@x.com', name: 'Andrew Li', email: 'me@x.com', kind: 'person' });
    const email = new RecordingSender();
    const r = await sendBlast({ job_id: 'job1', candidate_ids: [p.id] }, { repo, env: makeEnv({ OUTREACH_LIVE: true, PUBLIC_BASE_URL: 'https://operis.live' }), email });
    expect(r.sent).toBe(1);
    const m = email.sent[0]!;
    expect(m.html).toContain('View job &amp; accept');
    expect(m.html).toContain('A job that<br>fits you');
    expect(m.html).toMatch(/href="https:\/\/operis\.live\/j\/[A-Za-z0-9]{10}-[A-Za-z0-9_-]{8}"/);
    expect(m.html).not.toContain('How it works');
    expect(m.body).toContain('https://operis.live/j/');
    expect(m.subject).toContain('Fix our Next.js deploy bug');
  });
});
