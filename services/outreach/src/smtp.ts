/**
 * Email via SMTP, e.g. the Microsoft 365 (GoDaddy) mailbox ops@operis.live:
 *   SMTP_HOST=smtp.office365.com SMTP_PORT=587 SMTP_USER=ops@operis.live SMTP_PASSWORD=<app password>
 * One-time setup: enable "Authenticated SMTP" for the mailbox in the Microsoft 365 admin center.
 *
 * Replies: set SMTP_REPLY_TO to a Naïve inbox owned by the Ops agent, so STOP / MORE / questions wake
 * the agent automatically instead of landing in Outlook where nobody reads them.
 */
import nodemailer from 'nodemailer';
import type { EmailSender, SendResult } from './senders.js';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Display "From", e.g. `Operis <ops@operis.live>`. Defaults to the user. */
  from?: string;
  replyTo?: string;
}

/** Minimal transport shape so tests can inject a fake. */
export interface MailTransport {
  sendMail(msg: { from: string; to: string; replyTo?: string; subject: string; text: string; headers?: Record<string, string> }): Promise<{
    messageId?: string;
    rejected?: unknown[];
  }>;
}

export function smtpConfigFromEnv(source: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_REPLY_TO } = source;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) return null;
  return {
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    user: SMTP_USER,
    password: SMTP_PASSWORD,
    from: SMTP_FROM || `Operis <${SMTP_USER}>`,
    replyTo: SMTP_REPLY_TO || undefined,
  };
}

export class SmtpEmailSender implements EmailSender {
  private readonly transport: MailTransport;

  constructor(
    private readonly cfg: SmtpConfig,
    transport?: MailTransport,
  ) {
    this.transport =
      transport ??
      nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465, // 587 = STARTTLS
        requireTLS: cfg.port !== 465,
        auth: { user: cfg.user, pass: cfg.password },
      });
  }

  async send(to: string, subject: string, text: string): Promise<SendResult> {
    try {
      const info = await this.transport.sendMail({
        from: this.cfg.from ?? this.cfg.user,
        to,
        ...(this.cfg.replyTo ? { replyTo: this.cfg.replyTo } : {}),
        subject,
        text,
        // One-click unsubscribe hint for mail clients (Gmail/Outlook show an "Unsubscribe" button).
        headers: { 'List-Unsubscribe': `<mailto:${this.cfg.replyTo ?? this.cfg.user}?subject=STOP>` },
      });
      if (info.rejected && info.rejected.length > 0) return { ok: false, error: `rejected: ${String(info.rejected[0])}` };
      return { ok: true, ref: info.messageId };
    } catch (e) {
      // Never include credentials in errors.
      return { ok: false, error: e instanceof Error ? e.message.replace(this.cfg.password, '***') : 'smtp error' };
    }
  }
}
