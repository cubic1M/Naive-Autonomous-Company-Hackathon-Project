import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { InMemoryRepo } from '../src/repo/memory.js';
import { RecordingSender } from '../src/senders.js';
import { outreachTools } from '../src/tools.js';
import { FakeMonid, makeEnv, makeJob } from './helpers/fakeMonid.js';

describe('outreachTools', () => {
  function tools() {
    const repo = new InMemoryRepo();
    repo.addJob(makeJob({ id: 'job1', status: 'held' }));
    const email = new RecordingSender();
    return { repo, email, list: outreachTools({ repo, monid: new FakeMonid(), env: makeEnv(), email }) };
  }

  it('exposes find_people and send_blast with valid zod shapes', () => {
    const { list } = tools();
    expect(list.map((t) => t.name)).toEqual(['find_people', 'send_blast', 'manual_queue', 'mark_manual_sent']);
    expect(z.object(list[0].inputSchema).safeParse({ job_id: 'j' }).success).toBe(true);
    expect(z.object(list[1].inputSchema).safeParse({ job_id: 'j', candidate_ids: [] }).success).toBe(false);
  });

  it('find_people accepts hints', () => {
    const { list } = tools();
    const schema = z.object(list[0].inputSchema);
    expect(schema.safeParse({ job_id: 'j', hints: { roles: ['contract attorney'], skills: ['SaaS'], credential: 'CA bar', remote: true } }).success).toBe(true);
    expect(schema.safeParse({ job_id: 'j', hints: { credential: null } }).success).toBe(true);
    expect(schema.safeParse({ job_id: 'j', hints: { remote: 'yes' } }).success).toBe(false);
  });

  it('manual_queue lists queued DMs and mark_manual_sent updates them', async () => {
    const { repo, list } = tools();
    const w = repo.addPerson({ dedupe_key: 'k', name: 'Dan', profiles: [{ platform: 'linkedin', url: 'https://www.linkedin.com/in/dan', handle: 'dan' }] });
    const t = await repo.insertManualTask({ job_id: 'job1', worker_id: w.id, platform: 'linkedin', profile_url: 'https://www.linkedin.com/in/dan', message: 'Hi Dan' });
    const q = JSON.parse((await list[2].handler({ job_id: 'job1' })).content[0]!.text);
    expect(q.queue).toEqual([{ id: t.id, job_id: 'job1', platform: 'linkedin', profile_url: 'https://www.linkedin.com/in/dan', message: 'Hi Dan', status: 'queued' }]);
    expect(JSON.parse((await list[3].handler({ id: t.id, status: 'sent' })).content[0]!.text)).toEqual({ ok: true });
    expect(JSON.parse((await list[2].handler({})).content[0]!.text).queue).toEqual([]);
    expect(JSON.parse((await list[2].handler({ status: 'sent' })).content[0]!.text).queue).toHaveLength(1);
  });

  it('find_people then send_blast returns JSON text, dry-run by default', async () => {
    const { list, email } = tools();
    const found = JSON.parse((await list[0].handler({ job_id: 'job1', limit: 5 })).content[0]!.text);
    expect(Array.isArray(found.candidates)).toBe(true);
    const ids = found.candidates.map((c: { candidate_id: string }) => c.candidate_id);
    if (ids.length) {
      const sent = JSON.parse((await list[1].handler({ job_id: 'job1', candidate_ids: ids })).content[0]!.text);
      expect(sent.sent).toBe(0); // not live, not allowlisted
      expect(sent.outreach_ids.length).toBe(ids.length);
      expect(email.sent.length).toBe(0);
    }
  });

  it('returns isError instead of throwing for a missing job', async () => {
    const { list } = tools();
    const r = await list[0].handler({ job_id: 'nope' });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('not found');
  });
});
