import { createHmac } from 'crypto';
import { getPool } from '../storage/pg-pool.ts';
import { logger }   from '../utils/logger.ts';

export type WebhookEvent =
  | 'email.received' | 'email.replied' | 'email.ignored'
  | 'priority.critical' | 'draft.created' | 'account.error';

export class WebhookDispatcher {
  private static instance: WebhookDispatcher;
  static getInstance(): WebhookDispatcher {
    if (!this.instance) this.instance = new WebhookDispatcher();
    return this.instance;
  }

  async dispatch(event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
    let rows: any[];
    try {
      ({ rows } = await getPool().query(
        `SELECT * FROM webhooks WHERE enabled = TRUE AND events @> $1::jsonb`,
        [JSON.stringify([event])]
      ));
    } catch { return; }
    if (!rows.length) return;

    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data });
    await Promise.allSettled(rows.map((hook) => this.fire(hook, body)));
  }

  private async fire(hook: any, body: string): Promise<void> {
    const sig = createHmac('sha256', hook.secret).update(body).digest('hex');
    try {
      const ctrl    = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 10_000);
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type':           'application/json',
          'X-EmailAgent-Signature': `sha256=${sig}`,
        },
        body, signal: ctrl.signal,
      });
      clearTimeout(timeout);
      logger.debug('Webhook delivered', { url: hook.url, status: res.status });
    } catch (err: any) {
      logger.error('Webhook dispatch error', { url: hook.url, err: err.message });
    }
  }
}

export const webhookDispatcher = WebhookDispatcher.getInstance();
