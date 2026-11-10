/** Outbound email (acknowledgments, digests). Postmark in production; memory/console elsewhere. */
export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
  /** Postmark tag / message stream grouping, e.g. "acknowledgment". */
  tag?: string;
};

export type SendResult = { ok: boolean; id: string | null; skipped?: string };

export interface Mailer {
  readonly configured: boolean;
  send(mail: OutboundEmail): Promise<SendResult>;
}

/** Records mail instead of sending. Used in tests and in demo mode. */
export class MemoryMailer implements Mailer {
  readonly configured = true;
  sent: OutboundEmail[] = [];
  async send(mail: OutboundEmail): Promise<SendResult> {
    this.sent.push(mail);
    return { ok: true, id: `memory-${this.sent.length}` };
  }
}

/** No provider configured: logs one line and reports the skip so the UI can say so. */
export class ConsoleMailer implements Mailer {
  readonly configured = false;
  async send(mail: OutboundEmail): Promise<SendResult> {
    console.log(`[mail:not-configured] to=${mail.to} subject=${JSON.stringify(mail.subject)}`);
    return { ok: false, id: null, skipped: "Outbound email is not configured (POSTMARK_SERVER_TOKEN)" };
  }
}

export class PostmarkMailer implements Mailer {
  readonly configured = true;
  constructor(
    private opts: { serverToken: string; from: string; messageStream?: string; fetch?: typeof fetch },
  ) {}
  async send(mail: OutboundEmail): Promise<SendResult> {
    const res = await (this.opts.fetch ?? fetch)("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "x-postmark-server-token": this.opts.serverToken },
      body: JSON.stringify({
        From: this.opts.from,
        To: mail.to,
        Subject: mail.subject,
        TextBody: mail.text,
        ReplyTo: mail.replyTo ?? undefined,
        Tag: mail.tag,
        MessageStream: this.opts.messageStream ?? "outbound",
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { MessageID?: string; Message?: string };
    if (!res.ok) throw new Error(`Postmark send failed (${res.status}): ${body.Message ?? "unknown error"}`);
    return { ok: true, id: body.MessageID ?? null };
  }
}
