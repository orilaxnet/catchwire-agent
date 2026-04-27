import { createTransport } from 'nodemailer';
import { logger } from '../utils/logger.ts';
import { getPool } from '../storage/pg-pool.ts';
import { Encryption } from '../security/encryption.ts';

export interface OutboundEmail {
  from:       string;
  to:         string;
  subject:    string;
  body:       string;
  replyTo?:   string;
  inReplyTo?: string;
  references?: string;
}

export interface SendResult {
  success:   boolean;
  messageId?: string;
  error?:    string;
}

export class EmailSender {
  private enc: Encryption;

  constructor() {
    this.enc = new Encryption(process.env.ENCRYPTION_KEY!);
  }

  async send(accountId: string, email: OutboundEmail): Promise<SendResult> {
    const { rows } = await getPool().query(
      'SELECT * FROM email_accounts WHERE id = $1', [accountId]
    );
    const account = rows[0];

    if (!account) return { success: false, error: 'Account not found' };

    switch (account.account_type) {
      case 'gmail':
        return this.sendViaGmail(account, email);
      case 'imap':
        return this.sendViaSMTP(account, email);
      case 'forward':
        return this.sendViaRelay(email);
      default:
        return this.sendViaRelay(email);
    }
  }

  private async sendViaGmail(account: any, email: OutboundEmail): Promise<SendResult> {
    try {
      const { google } = await import('googleapis');

      const creds = account.credentials_enc
        ? JSON.parse(this.enc.decrypt(account.credentials_enc))
        : null;

      if (!creds?.access_token) {
        return { success: false, error: 'Gmail not authorized — re-connect account' };
      }

      const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI,
      );
      oauth2Client.setCredentials({
        access_token:  creds.access_token,
        refresh_token: creds.refresh_token,
      });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      const raw = this.buildRFC822(email);
      const encoded = Buffer.from(raw).toString('base64url');

      const res = await gmail.users.messages.send({
        userId:      'me',
        requestBody: { raw: encoded },
      });

      logger.info('Email sent via Gmail', { messageId: res.data.id, to: email.to });
      return { success: true, messageId: res.data.id ?? undefined };
    } catch (err: any) {
      logger.error('Gmail send failed', { err });
      return { success: false, error: err.message };
    }
  }

  private async sendViaSMTP(account: any, email: OutboundEmail): Promise<SendResult> {
    try {
      const creds = account.credentials_enc
        ? JSON.parse(this.enc.decrypt(account.credentials_enc))
        : null;

      if (!creds?.smtp_host) {
        return { success: false, error: 'SMTP credentials not configured' };
      }

      const transporter = createTransport({
        host:   creds.smtp_host,
        port:   creds.smtp_port ?? 587,
        secure: creds.smtp_port === 465,
        auth: {
          user: creds.smtp_user,
          pass: creds.smtp_pass,
        },
      });

      const info = await transporter.sendMail({
        from:       email.from,
        to:         email.to,
        subject:    email.subject,
        text:       email.body,
        inReplyTo:  email.inReplyTo,
        references: email.references,
      });

      logger.info('Email sent via SMTP', { messageId: info.messageId, to: email.to });
      return { success: true, messageId: info.messageId };
    } catch (err: any) {
      logger.error('SMTP send failed', { err });
      return { success: false, error: err.message };
    }
  }

  private async sendViaRelay(email: OutboundEmail): Promise<SendResult> {
    const host = process.env.SMTP_RELAY_HOST || process.env.SMTP_HOST;
    if (!host) {
      logger.warn('No SMTP relay configured — email not sent', { to: email.to });
      return { success: false, error: 'No outbound SMTP configured' };
    }

    try {
      const transporter = createTransport({
        host,
        port:   parseInt(process.env.SMTP_RELAY_PORT || '587'),
        secure: false,
        auth: process.env.SMTP_RELAY_USER ? {
          user: process.env.SMTP_RELAY_USER,
          pass: process.env.SMTP_RELAY_PASS,
        } : undefined,
      });

      const info = await transporter.sendMail({
        from:    email.from,
        to:      email.to,
        subject: email.subject,
        text:    email.body,
      });

      logger.info('Email sent via relay', { messageId: info.messageId, to: email.to });
      return { success: true, messageId: info.messageId };
    } catch (err: any) {
      logger.error('Relay send failed', { err });
      return { success: false, error: err.message };
    }
  }

  private buildRFC822(email: OutboundEmail): string {
    const lines = [
      `From: ${email.from}`,
      `To: ${email.to}`,
      `Subject: ${email.subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=UTF-8`,
    ];
    if (email.inReplyTo)  lines.push(`In-Reply-To: ${email.inReplyTo}`);
    if (email.references) lines.push(`References: ${email.references}`);
    lines.push('', email.body);
    return lines.join('\r\n');
  }
}
