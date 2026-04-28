/**
 * Mail.TM HTTP-API Poller
 * Polls api.mail.tm for new messages instead of IMAP.
 * Used for mail.tm / disposable-email testing accounts.
 */

import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.ts';
import type { RawEmail } from '../types/index.ts';

interface MailTMConfig {
  address:  string;
  password: string;
}

type RawEmailHandler = (email: RawEmail) => Promise<void>;

interface MailTMMessage {
  id:        string;
  from:      { address: string; name: string };
  to:        Array<{ address: string; name: string }>;
  subject:   string;
  intro:     string;
  seen:      boolean;
  text?:     string;
  html?:     string | string[];
  createdAt: string;
}

const API = 'https://api.mail.tm';

export class MailTMPoller {
  private intervalId?: ReturnType<typeof setInterval>;
  private token: string | null = null;
  private seenIds = new Set<string>();

  constructor(
    private accountId: string,
    private config: MailTMConfig,
    private onEmail: RawEmailHandler,
    private intervalMin = 1,
  ) {}

  start(): void {
    this.poll();
    this.intervalId = setInterval(() => this.poll(), this.intervalMin * 60 * 1000);
    logger.info('MailTM poller started', { accountId: this.accountId, address: this.config.address });
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private async getToken(): Promise<string> {
    if (this.token) return this.token;
    const r = await fetch(`${API}/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ address: this.config.address, password: this.config.password }),
    });
    if (!r.ok) throw new Error(`MailTM auth failed: ${r.status}`);
    const data = await r.json() as { token: string };
    this.token = data.token;
    return this.token;
  }

  private async poll(): Promise<void> {
    try {
      const token = await this.getToken();
      const r     = await fetch(`${API}/messages?page=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (r.status === 401) { this.token = null; return; }
      if (!r.ok) return;

      const data = await r.json() as { 'hydra:member': MailTMMessage[] };
      const msgs = data['hydra:member'] ?? [];

      for (const msg of msgs) {
        if (this.seenIds.has(msg.id)) continue;
        this.seenIds.add(msg.id);

        // Fetch full message for body
        const full = await this.fetchFull(token, msg.id);
        if (!full) continue;

        // Build RFC-822-like raw string so simpleParser / our pipeline can handle it
        const bodyText = full.text ?? (Array.isArray(full.html) ? full.html.join('\n') : full.html ?? full.intro);
        const raw = [
          `Message-ID: <${msg.id}@mail.tm>`,
          `Date: ${full.createdAt}`,
          `From: ${full.from.name ? `"${full.from.name}" ` : ''}<${full.from.address}>`,
          `To: ${full.to.map((t) => t.address).join(', ')}`,
          `Subject: ${full.subject}`,
          `Content-Type: text/plain; charset=utf-8`,
          ``,
          bodyText,
        ].join('\r\n');

        await this.onEmail({
          id:         randomUUID(),
          accountId:  this.accountId,
          receivedAt: new Date(full.createdAt),
          source:     'imap' as any,
          raw,
          headers: {
            from:       full.from.address,
            to:         full.to.map((t) => t.address).join(', '),
            subject:    full.subject,
            date:       full.createdAt,
            'message-id': `<${msg.id}@mail.tm>`,
          },
        });

        logger.info('MailTM message ingested', { subject: full.subject, from: full.from.address });
      }
    } catch (err) {
      logger.error('MailTM poll error', { accountId: this.accountId, err });
      this.token = null; // force re-auth on next cycle
    }
  }

  private async fetchFull(token: string, id: string): Promise<MailTMMessage | null> {
    try {
      const r = await fetch(`${API}/messages/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return null;
      return await r.json() as MailTMMessage;
    } catch {
      return null;
    }
  }
}
