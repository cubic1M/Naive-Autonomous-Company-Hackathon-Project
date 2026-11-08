import type { EmailSender, SendResult } from '../../outreach/src/senders.js';
import type { GrowthDeps } from './deps.js';
import type { Family } from './families.js';
import type { Decision } from './guard.js';
import type { EmailMessage } from './templates.js';
import type { Contact, MessageKind } from './types.js';

export type SendStatus = 'sent' | 'dry_run' | 'skipped' | 'failed';
export interface Outcome {
  status: SendStatus;
  reason?: string;
}

/** Record a guard skip. */
export async function logSkip(deps: GrowthDeps, c: Contact, kind: MessageKind, reason: string, family: Family | null = null): Promise<Outcome> {
  await deps.repo.log({ contact_id: c.id, kind, status: 'skipped', reason, family });
  return { status: 'skipped', reason };
}

/** Carry out a send or dry-run decision and log it. Only a real send marks the contact as contacted. */
export async function deliver(
  deps: GrowthDeps,
  a: {
    contact: Contact;
    kind: MessageKind;
    family?: Family | null;
    decision: Exclude<Decision, { action: 'skip' }>;
    message: EmailMessage;
    sender: EmailSender | undefined;
    senderHint: string;
  },
): Promise<Outcome> {
  const base = { contact_id: a.contact.id, kind: a.kind, family: a.family ?? null };
  if (a.decision.action === 'dry_run') {
    await deps.repo.log({ ...base, status: 'dry_run' });
    return { status: 'dry_run' };
  }
  if (!a.sender) {
    await deps.repo.log({ ...base, status: 'failed', reason: 'no_sender' });
    return { status: 'failed', reason: `no_sender: ${a.senderHint}` };
  }
  const res: SendResult = await a.sender
    .send(a.contact.email, a.message.subject, a.message.text)
    .catch((e: unknown): SendResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  if (!res.ok) {
    const reason = (res.error ?? 'send failed').slice(0, 300);
    await deps.repo.log({ ...base, status: 'failed', reason });
    return { status: 'failed', reason };
  }
  await deps.repo.markContacted(a.contact.id, deps.now());
  await deps.repo.log({ ...base, status: 'sent', reason: a.decision.mode === 'test' ? 'allowlist' : null, ref: res.ref ?? null });
  return { status: 'sent' };
}
