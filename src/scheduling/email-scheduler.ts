import { randomUUID } from 'crypto';
import { getPool } from '../storage/pg-pool.ts';
import { logger }   from '../utils/logger.ts';

export interface ScheduledEmail {
  id:        string;
  accountId: string;
  to:        string;
  subject:   string;
  body:      string;
  sendAt:    Date;
  status:    'scheduled' | 'sent' | 'failed' | 'cancelled';
  createdAt: Date;
}

type SendFn = (email: ScheduledEmail) => Promise<void>;

export class EmailScheduler {
  private timer:  ReturnType<typeof setInterval> | null = null;
  private sendFn: SendFn | null = null;

  async start(sendFn: SendFn): Promise<void> {
    this.sendFn = sendFn;
    this.timer  = setInterval(() => this.tick(sendFn), 60_000);
    logger.info('EmailScheduler started');
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async scheduleEmail(data: Omit<ScheduledEmail, 'id' | 'status' | 'createdAt'>): Promise<string> {
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO scheduled_emails (id, account_id, to_address, subject, body, send_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')`,
      [id, data.accountId, data.to, data.subject, data.body, data.sendAt]
    );
    logger.info('Email scheduled', { id, sendAt: data.sendAt });
    return id;
  }

  async cancel(id: string): Promise<void> {
    await getPool().query(
      `UPDATE scheduled_emails SET status = 'cancelled' WHERE id = $1 AND status = 'scheduled'`,
      [id]
    );
  }

  private async tick(sendFn: SendFn): Promise<void> {
    const { rows } = await getPool().query(
      `SELECT * FROM scheduled_emails WHERE status = 'scheduled' AND send_at <= NOW() LIMIT 20`
    );
    for (const row of rows) {
      await this.processRow(row, sendFn).catch(() => {});
    }
  }

  private async processRow(row: any, sendFn: SendFn): Promise<void> {
    try {
      await sendFn({
        id:        row.id,
        accountId: row.account_id,
        to:        row.to_address ?? '',
        subject:   row.subject ?? '',
        body:      row.body ?? '',
        sendAt:    new Date(row.send_at),
        status:    'scheduled',
        createdAt: new Date(row.created_at),
      });
      await getPool().query(
        `UPDATE scheduled_emails SET status = 'sent' WHERE id = $1`, [row.id]
      );
      logger.info('Scheduled email sent', { id: row.id });
    } catch (err) {
      await getPool().query(
        `UPDATE scheduled_emails SET status = 'failed' WHERE id = $1`, [row.id]
      );
      logger.error('Scheduled email failed', { id: row.id, err });
      throw err;
    }
  }
}
