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
    expect(list.map((t) => t.name)).toEqual(['find_people', 'send_blast']);
    expect(z.object(list[0].inputSchema).safeParse({ job_id: 'j' }).success).toBe(true);
    expect(z.object(list[1].inputSchema).safeParse({ job_id: 'j', candidate_ids: [] }).success).toBe(false);
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
