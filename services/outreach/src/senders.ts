/**
 * Message senders. send_blast depends on these interfaces only.
 * - Email: Naïve identity inbox (ops@), via POST /v1/identities/{identityId}/emails/{inboxId}/send.
 * - SMS: injected by apps/api (Edwin's lib/messaging.ts sendSms: Mobilerun, fallback Monid AgentLine).
 */

import { succeeded, type Monid } from './monid.js';

export interface SendResult {
  ok: boolean;
  /** Provider message id, if any. */
  ref?: string;
  cost_usd?: number;
  error?: string;
}

export interface EmailSender {
  /** `html` is optional: senders that support it send both (text stays the fallback part). */
  send(to: string, subject: string, text: string, html?: string): Promise<SendResult>;
}

export interface SmsSender {
  send(to: string, body: string): Promise<SendResult>;
}

export class NaiveEmailSender implements EmailSender {
  constructor(
    private readonly cfg: { apiKey: string; baseUrl: string; identityId: string; inboxId: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(to: string, subject: string, text: string): Promise<SendResult> {
    const url = `${this.cfg.baseUrl}/v1/identities/${encodeURIComponent(this.cfg.identityId)}/emails/${encodeURIComponent(
      this.cfg.inboxId,
    )}/send`;
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: [to], subject, text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { ok: false, error: `naive email ${res.status}: ${body.slice(0, 200)}` };
      }
      const data = (await res.json().catch(() => ({}))) as { accepted?: boolean; sent_at?: string };
      return { ok: data.accepted !== false, ref: data.sent_at };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

/**
 * Email via AgentMail through Monid (agentmail /send-messages, $0.001 per recipient).
 * Used until the Naïve ops@ inbox is set up; the inbox must be one we own (e.g. operis-ops@agentmail.to).
 */
export class MonidEmailSender implements EmailSender {
  constructor(
    private readonly monid: Monid,
    private readonly inboxId: string,
  ) {}

  async send(to: string, subject: string, text: string, html?: string): Promise<SendResult> {
    try {
      const body: Record<string, unknown> = { inboxId: this.inboxId, to, subject, text };
      if (html) body.html = html;
      const r = await this.monid.run('agentmail', '/send-messages', { body }, { timeoutMs: 30_000 });
      if (!succeeded(r)) return { ok: false, error: `agentmail send: ${r.status} (http ${r.httpStatus ?? 'n/a'})`, cost_usd: r.cost_usd };
      const out = (r.output ?? {}) as { message_id?: string; messageId?: string };
      return { ok: true, ref: out.message_id ?? out.messageId ?? r.runId, cost_usd: r.cost_usd };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** Records messages instead of sending them. Used for dry runs and tests. */
export class RecordingSender implements EmailSender, SmsSender {
  readonly sent: { to: string; subject?: string; body: string; html?: string }[] = [];
  constructor(private readonly fail: (to: string) => boolean = () => false) {}
  async send(to: string, a: string, b?: string, html?: string): Promise<SendResult> {
    if (this.fail(to)) return { ok: false, error: 'forced failure' };
    if (b === undefined) this.sent.push({ to, body: a });
    else this.sent.push({ to, subject: a, body: b, ...(html ? { html } : {}) });
    return { ok: true, ref: `rec_${this.sent.length}` };
  }
}
