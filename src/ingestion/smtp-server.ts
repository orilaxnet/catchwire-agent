/**
 * SMTP Server — receives forwarded emails
 * User forwards email to agent@yourdomain.com
 */

import { SMTPServer as NodeSMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.ts';
import type { RawEmail } from '../types/index.ts';

type EmailHandler = (email: RawEmail) => Promise<void>;

export class SMTPIngestion {
  private server: NodeSMTPServer;
  private onEmail: EmailHandler;

  constructor(onEmail: EmailHandler) {
    this.onEmail = onEmail;

    this.server = new NodeSMTPServer({
      // Phase 0: no auth required (local only; add IP allowlist for production)
      authOptional: true,
      disabledCommands: ['AUTH'],

      onData: (stream, session, callback) => {
        this.handleIncoming(stream, session, callback);
      },

      onConnect: (session, callback) => {
        const remote = session.remoteAddress ?? '';
        logger.debug('SMTP connection', { remoteAddress: remote });

        // Enforce IP allowlist when SMTP_ALLOWED_IPS is set (comma-separated).
        // In production this MUST be configured to prevent open-relay abuse.
        const allowed = process.env.SMTP_ALLOWED_IPS;
        if (allowed) {
          const list = allowed.split(',').map((s) => s.trim());
          if (!list.includes(remote)) {
            logger.warn('SMTP connection rejected — IP not in allowlist', { remoteAddress: remote });
            callback(new Error('Not authorised'));
            return;
          }
        }
        callback();
      },

      logger: false,
    });
  }

  async start(): Promise<void> {
    const port = parseInt(process.env.SMTP_PORT || '25');
    const host = process.env.SMTP_HOST || '0.0.0.0';

    return new Promise((resolve, reject) => {
      this.server.listen(port, host, (err?: Error) => {
        if (err) reject(err);
        else {
          logger.info(`SMTP server listening on ${host}:${port}`);
          resolve();
        }
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(resolve as any));
  }

  private handleIncoming(stream: any, session: any, callback: Function): void {
    const chunks: Buffer[] = [];

    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');

      try {
        const parsed = await simpleParser(raw);

        // Resolve recipient account from RCPT TO address
        const recipientAddress = session.envelope?.rcptTo?.[0]?.address || '';
        const accountId        = await this.resolveAccountId(recipientAddress);

        const email: RawEmail = {
          id:          randomUUID(),
          accountId,
          receivedAt:  new Date(),
          source:      'forward',
          raw,
          headers:     Object.fromEntries(
            Object.entries(parsed.headers).map(([k, v]) => [k, String(v)])
          ),
        };

        await this.onEmail(email);
        callback();
      } catch (err) {
        logger.error('SMTP parsing error', err as Error);
        callback(new Error('Processing failed'));
      }
    });
  }

  private async resolveAccountId(recipientEmail: string): Promise<string> {
    const { getPool } = await import('../storage/pg-pool.ts');
    const pool = getPool();

    const { rows } = await pool.query(
      'SELECT id FROM email_accounts WHERE email_address = $1 LIMIT 1',
      [recipientEmail]
    );
    if (rows[0]) return rows[0].id;

    // Fall back to first account (Phase 0 — single user)
    const { rows: first } = await pool.query('SELECT id FROM email_accounts LIMIT 1');
    return first[0]?.id ?? 'default';
  }
}
