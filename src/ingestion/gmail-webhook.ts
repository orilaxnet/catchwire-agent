/**
 * Gmail Webhook — OAuth2 + Google Pub/Sub Push Notification
 * Phase 1
 */

import { google } from 'googleapis';
import { logger } from '../utils/logger.ts';
import type { RawEmail } from '../types/index.ts';
import { randomUUID } from 'crypto';

type RawEmailHandler = (email: RawEmail) => Promise<void>;

export class GmailWebhook {
  private oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI,
  );

  constructor(private onEmail: RawEmailHandler) {}

  /** Generate OAuth URL for the user to authorize.
   *  Pass a random CSRF state token when going through the web callback flow.
   *  The Telegram manual-code flow may omit it (already authenticated via bot token). */
  getAuthUrl(state?: string): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
      ],
      prompt: 'consent',
      ...(state ? { state } : {}),
    });
  }

  /** Call after the user completes the OAuth redirect */
  async handleCallback(code: string): Promise<{ accessToken: string; refreshToken: string }> {
    const { tokens } = await this.oauth2Client.getToken(code);
    return {
      accessToken:  tokens.access_token  ?? '',
      refreshToken: tokens.refresh_token ?? '',
    };
  }

  /** Express handler for Pub/Sub push notifications */
  async handlePushNotification(body: any, accountId: string, credentials: {
    accessToken: string;
    refreshToken: string;
  }): Promise<void> {
    try {
      const data      = Buffer.from(body.message.data, 'base64').toString('utf8');
      const notification = JSON.parse(data) as { historyId: string; emailAddress: string };

      this.oauth2Client.setCredentials({
        access_token:  credentials.accessToken,
        refresh_token: credentials.refreshToken,
      });

      const gmail   = google.gmail({ version: 'v1', auth: this.oauth2Client });
      const history = await gmail.users.history.list({
        userId:        'me',
        startHistoryId: notification.historyId,
        historyTypes:  ['messageAdded'],
      });

      for (const record of history.data.history ?? []) {
        for (const msg of record.messagesAdded ?? []) {
          await this.fetchAndProcess(gmail, accountId, msg.message?.id ?? '');
        }
      }
    } catch (err) {
      logger.error('Gmail webhook error', err as Error);
    }
  }

  private async fetchAndProcess(gmail: any, accountId: string, messageId: string): Promise<void> {
    const res = await gmail.users.messages.get({
      userId: 'me',
      id:     messageId,
      format: 'raw',
    });

    const raw = Buffer.from(res.data.raw, 'base64').toString('utf8');
    const headers: Record<string, string> = {};
    for (const h of res.data.payload?.headers ?? []) {
      headers[h.name.toLowerCase()] = h.value;
    }

    await this.onEmail({
      id:         randomUUID(),
      accountId,
      receivedAt: new Date(),
      source:     'gmail',
      raw,
      headers,
    });
  }

  /** Register a Pub/Sub watch — must be renewed every 7 days */
  async setupWatch(accessToken: string, refreshToken: string): Promise<void> {
    this.oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

    await gmail.users.watch({
      userId: 'me',
      requestBody: {
        labelIds:  ['INBOX'],
        topicName: process.env.GMAIL_PUBSUB_TOPIC,
      },
    });
    logger.info('Gmail watch registered');
  }
}
