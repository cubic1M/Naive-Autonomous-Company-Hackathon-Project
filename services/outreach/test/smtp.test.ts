import { describe, expect, it } from 'vitest';
import { SmtpEmailSender, smtpConfigFromEnv, type MailTransport } from '../src/smtp.js';

const cfg = { host: 'smtp.office365.com', port: 587, user: 'ops@operis.live', password: 's3cret', from: 'Operis <ops@operis.live>', replyTo: 'ops-replies@naive.example' };

describe('SmtpEmailSender', () => {
  it('sends from ops@operis.live with Reply-To and an unsubscribe header', async () => {
    const sent: Parameters<MailTransport['sendMail']>[0][] = [];
    const s = new SmtpEmailSender(cfg, { sendMail: async (m) => (sent.push(m), { messageId: '<m1>' }) });
    const r = await s.send('azli@stanford.edu', 'Subj', 'Body');
    expect(r).toEqual({ ok: true, ref: '<m1>' });
    expect(sent[0]).toMatchObject({ from: 'Operis <ops@operis.live>', to: 'azli@stanford.edu', replyTo: 'ops-replies@naive.example', subject: 'Subj', text: 'Body' });
    expect(sent[0]!.headers!['List-Unsubscribe']).toContain('mailto:ops-replies@naive.example');
  });

  it('reports rejection and never leaks the password in errors', async () => {
    const rejected = new SmtpEmailSender(cfg, { sendMail: async () => ({ rejected: ['azli@stanford.edu'] }) });
    expect((await rejected.send('azli@stanford.edu', 's', 't')).ok).toBe(false);
    const failing = new SmtpEmailSender(cfg, {
      sendMail: async () => {
        throw new Error('535 auth failed for s3cret');
      },
    });
    const r = await failing.send('a@b.com', 's', 't');
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain('s3cret');
  });

  it('reads config from env, null when incomplete', () => {
    expect(smtpConfigFromEnv({})).toBeNull();
    expect(smtpConfigFromEnv({ SMTP_HOST: 'smtp.office365.com', SMTP_USER: 'ops@operis.live', SMTP_PASSWORD: 'x' })).toMatchObject({
      port: 587,
      from: 'Operis <ops@operis.live>',
    });
  });
});
