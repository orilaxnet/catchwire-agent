import { getPool } from '../storage/pg-pool.ts';
import { logger }   from '../utils/logger.ts';

export interface FollowUpRule {
  accountId:     string;
  emailLogId:    string;
  followUpAfter: number; // hours
  message:       string;
  status:        'pending' | 'triggered' | 'dismissed';
}

export class FollowUpManager {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(triggerFn: (rule: FollowUpRule & { id: string }) => Promise<void>): void {
    this.timer = setInterval(() => this.tick(triggerFn), 5 * 60_000);
    logger.info('FollowUpManager started');
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async schedule(rule: FollowUpRule): Promise<string> {
    const { rows } = await getPool().query(
      `INSERT INTO follow_ups (account_id, email_log_id, follow_up_after_hours, message, status)
       VALUES ($1,$2,$3,$4,'pending') RETURNING id`,
      [rule.accountId, rule.emailLogId, rule.followUpAfter, rule.message]
    );
    logger.info('Follow-up scheduled', { id: rows[0].id });
    return rows[0].id;
  }

  async dismiss(id: string): Promise<void> {
    await getPool().query(
      `UPDATE follow_ups SET status = 'dismissed' WHERE id = $1`, [id]
    );
  }

  private async tick(triggerFn: (rule: FollowUpRule & { id: string }) => Promise<void>): Promise<void> {
    const { rows } = await getPool().query(`
      SELECT * FROM follow_ups
      WHERE status = 'pending'
        AND created_at + (follow_up_after_hours || ' hours')::interval <= NOW()
      LIMIT 10
    `);
    for (const row of rows) {
      try {
        await triggerFn({
          id: row.id, accountId: row.account_id, emailLogId: row.email_log_id,
          followUpAfter: row.follow_up_after_hours, message: row.message, status: 'pending',
        });
        await getPool().query(
          `UPDATE follow_ups SET status = 'triggered' WHERE id = $1`, [row.id]
        );
      } catch (err) {
        logger.error('Follow-up trigger failed', { id: row.id, err });
      }
    }
  }
}
