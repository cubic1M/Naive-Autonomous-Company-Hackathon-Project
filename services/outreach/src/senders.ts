/**
 * Message senders. send_blast depends on these interfaces only.
 * - Email: Naïve identity inbox (ops@), via POST /v1/identities/{identityId}/emails/{inboxId}/send.
 * - SMS: injected by apps/api (Edwin's lib/messaging.ts sendSms: Mobilerun, fallback Monid AgentLine).
 */

export interface SendResult {
  ok: boolean;
  /** Provider message id, if any. */
  ref?: string;
  cost_usd?: number;
  error?: string;
}

export interface EmailSender {
  send(to: string, subject: string, text: string): Promise<SendResult>;
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

/** Records messages instead of sending them. Used for dry runs and tests. */
export class RecordingSender implements EmailSender, SmsSender {
  readonly sent: { to: string; subject?: string; body: string }[] = [];
  constructor(private readonly fail: (to: string) => boolean = () => false) {}
  async send(to: string, a: string, b?: string): Promise<SendResult> {
    if (this.fail(to)) return { ok: false, error: 'forced failure' };
    if (b === undefined) this.sent.push({ to, body: a });
    else this.sent.push({ to, subject: a, body: b });
    return { ok: true, ref: `rec_${this.sent.length}` };
  }
}
