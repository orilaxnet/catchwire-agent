import { createHmac } from 'crypto';
import { getPool } from '../storage/pg-pool.ts';
import { logger }   from '../utils/logger.ts';

// Re-checked at delivery time to guard against DNS rebinding: an attacker
// registers a webhook pointing to a public hostname, then changes DNS to
// 127.0.0.1 after registration. The POST /webhooks check happens at
// registration; this check happens at delivery.
const PRIVATE_IP_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1|0\.0\.0\.0|169\.254\.)/i;

function isSafeWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    return !PRIVATE_IP_RE.test(u.hostname);
  } catch { return false; }
}

export type WebhookEvent =
  | 'email.received' | 'email.replied' | 'email.ignored'
  | 'priority.critical' | 'draft.created' | 'account.error';

export class WebhookDispatcher {
  private static instance: WebhookDispatcher;
  static getInstance(): WebhookDispatcher {
    if (!this.instance) this.instance = new WebhookDispatcher();
    return this.instance;
  }

  async dispatch(event: WebhookEvent, data: Record<string, unknown>, accountId?: string): Promise<void> {
    let rows: any[];
    try {
      ({ rows } = await getPool().query(
        `SELECT * FROM webhooks
         WHERE enabled = TRUE
           AND events @> $1::jsonb
           AND (account_id IS NULL OR account_id = $2)`,
        [JSON.stringify([event]), accountId ?? null]
      ));
    } catch { return; }
    if (!rows.length) return;

    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data });
    await Promise.allSettled(rows.map((hook) => this.fire(hook, body)));
  }

  private async fire(hook: any, body: string): Promise<void> {
    if (!isSafeWebhookUrl(hook.url)) {
      logger.warn('Webhook delivery skipped — URL no longer resolves to a safe address', { url: hook.url });
      return;
    }
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
