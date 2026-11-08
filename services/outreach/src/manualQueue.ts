/**
 * The manual DM queue: messages the Ops agent drafted for people we can only reach by DM
 * (LinkedIn InMail/connection note, X, Reddit, Instagram). A teammate sends them from a real
 * Operis account and marks them sent. Shown on the dashboard and summarized on the board card.
 */
import type { Repo } from './repo.js';
import type { ManualTask, ManualTaskStatus } from './types.js';

export async function listManualQueue(repo: Repo, filter: { job_id?: string; status?: ManualTaskStatus } = { status: 'queued' }): Promise<ManualTask[]> {
  return repo.listManualTasks(filter);
}

export async function markManualSent(repo: Repo, id: string, status: 'sent' | 'skipped' = 'sent', now: Date = new Date()): Promise<void> {
  await repo.markManualTask(id, status, now);
}
