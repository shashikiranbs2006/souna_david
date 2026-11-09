import type { MailMessage, Mailer } from '../types.ts';
import { formatFromAddress, isPlausibleEmail } from './from-address.ts';
import { singleLine } from './escape.ts';

export interface ResendMailerConfig {
  apiKey: string;
  /** Sender address on a domain verified at Resend, e.g. `offers@holzsauna.klardatalabs.com`. */
  fromAddress: string;
  defaultFromName: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

/** Sends mail through the Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendMailer implements Mailer {
  constructor(private readonly config: ResendMailerConfig) {}

  async send(message: MailMessage): Promise<{ messageId: string }> {
    if (!isPlausibleEmail(message.to)) throw new Error('Invalid recipient address');
    const body = {
      from: formatFromAddress(message.fromName ?? this.config.defaultFromName, this.config.fromAddress),
      to: [message.to],
      subject: singleLine(message.subject),
      html: message.html,
      text: message.text,
      ...(message.replyTo && isPlausibleEmail(message.replyTo) ? { reply_to: message.replyTo } : {}),
      ...(message.attachments?.length ? { attachments: message.attachments.map(a => ({ filename: a.filename, content: a.contentBase64 })) } : {}),
    };
    const res = await (this.config.fetchImpl ?? fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !json.id) throw new Error(`Resend refused the mail (${res.status}): ${json.message ?? 'no detail'}`);
    return { messageId: json.id };
  }
}
