import { randomUUID }  from 'crypto';
import { EventEmitter } from 'events';
import { logger }       from '../utils/logger.ts';
import { getPool }      from '../storage/pg-pool.ts';
import { ForwardingParser } from '../parser/forwarding-parser.ts';
import { Encryption }   from '../security/encryption.ts';
import type { RawEmail, ParsedEmail } from '../types/index.ts';

type ParsedEmailHandler = (email: ParsedEmail) => Promise<void>;

export class MultiAccountManager extends EventEmitter {
  private parser: ForwardingParser;
  private handlers: ParsedEmailHandler[] = [];

  constructor(private encryption: Encryption) {
    super();
    this.parser = new ForwardingParser();
  }

  async initialize(): Promise<void> {
    const { rows } = await getPool().query(
      `SELECT * FROM email_accounts WHERE enabled = TRUE`
    );
    logger.info(`Multi-account manager: ${rows.length} account(s) active`);

    for (const acc of rows) {
      if (acc.account_type === 'imap' && acc.credentials_enc) {
        await this.startIMAPPoller(acc);
      } else if (acc.account_type === 'gmail') {
        logger.info('Gmail uses webhooks — no polling needed', { accountId: acc.id });
      }
    }
  }

  private async startIMAPPoller(account: any): Promise<void> {
    try {
      const creds = account.credentials_enc
        ? JSON.parse(this.encryption.decrypt(account.credentials_enc))
        : null;
      if (!creds?.imap_host) {
        logger.warn('IMAP account missing credentials', { accountId: account.id }); return;
      }
      const { IMAPPoller } = await import('./imap-poller.ts');
      const poller = new IMAPPoller(
        account.id,
        { host: creds.imap_host, port: creds.imap_port ?? 993,
          user: creds.imap_user ?? account.email_address,
          password: creds.imap_pass, tls: creds.imap_port !== 143 },
        (raw) => this.ingest(raw),
        account.polling_interval_min ?? 5,
      );
      poller.start();
      logger.info('IMAP poller started', { accountId: account.id });
    } catch (err) {
      logger.error('Failed to start IMAP poller', { accountId: account.id, err });
    }
  }

  async ingest(raw: RawEmail): Promise<void> {
    try {
      const parsed = await this.parser.parse(raw);
      logger.info('Email ingested', { accountId: parsed.accountId, sender: parsed.originalSender, subject: parsed.subject });
      for (const handler of this.handlers) await handler(parsed);
    } catch (err) {
      logger.error('Failed to ingest email', err as Error);
    }
  }

  onEmailReceived(handler: ParsedEmailHandler): void {
    this.handlers.push(handler);
  }

  async addAccount(userId: string, data: {
    emailAddress: string; displayName?: string;
    accountType: 'gmail' | 'outlook' | 'imap' | 'forward';
    credentials?: object; priority?: number;
  }): Promise<string> {
    const id   = randomUUID();
    const pool = getPool();
    await pool.query(
      `INSERT INTO email_accounts (id, user_id, email_address, display_name, account_type, enabled, priority)
       VALUES ($1,$2,$3,$4,$5,TRUE,$6)`,
      [id, userId, data.emailAddress, data.displayName ?? null, data.accountType, data.priority ?? 5]
    );
    await pool.query(`INSERT INTO personas (account_id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);

    if (data.credentials) {
      const enc = this.encryption.encrypt(JSON.stringify(data.credentials));
      await pool.query('UPDATE email_accounts SET credentials_enc = $1 WHERE id = $2', [enc, id]);
    }
    logger.info('Account added', { accountId: id, email: data.emailAddress });
    return id;
  }
}
