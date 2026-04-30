/**
 * Label Manager — custom AI-generated email labels.
 * Users define labels (e.g. "Job Applications", "Vendor Renewals").
 * The LLM auto-assigns them during email analysis.
 */

import { getPool } from '../storage/pg-pool.ts';
import { logger }  from '../utils/logger.ts';

export interface Label {
  id:        string;
  accountId: string;
  name:      string;
  color:     string;
  createdAt: Date;
}

export class LabelManager {
  async list(accountId: string): Promise<Label[]> {
    const { rows } = await getPool().query(
      `SELECT * FROM email_labels WHERE account_id = $1 ORDER BY name`, [accountId]
    );
    return rows.map(this.mapRow);
  }

  async create(accountId: string, name: string, color = '#6366f1'): Promise<Label> {
    const { rows } = await getPool().query(
      `INSERT INTO email_labels (account_id, name, color) VALUES ($1, $2, $3)
       ON CONFLICT (account_id, name) DO UPDATE SET color = EXCLUDED.color
       RETURNING *`,
      [accountId, name.trim(), color]
    );
    return this.mapRow(rows[0]);
  }

  async delete(accountId: string, labelId: string): Promise<void> {
    await getPool().query(
      `DELETE FROM email_labels WHERE id = $1 AND account_id = $2`, [labelId, accountId]
    );
  }

  async assignToEmail(emailLogId: string, labelNames: string[], accountId: string): Promise<void> {
    if (!labelNames.length) return;
    const pool = getPool();
    for (const name of labelNames) {
      try {
        // Upsert the label then link it
        const { rows } = await pool.query(
          `INSERT INTO email_labels (account_id, name) VALUES ($1, $2)
           ON CONFLICT (account_id, name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [accountId, name]
        );
        await pool.query(
          `INSERT INTO email_log_labels (email_log_id, label_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [emailLogId, rows[0].id]
        );
      } catch (err) {
        logger.debug('assignToEmail error', { err });
      }
    }

    // Also store labels in email_log.labels for quick reads
    await pool.query(
      `UPDATE email_log SET labels = $1 WHERE id = $2`,
      [JSON.stringify(labelNames), emailLogId]
    );
  }

  async getForEmail(emailLogId: string): Promise<string[]> {
    const { rows } = await getPool().query(
      `SELECT el.name FROM email_labels el
       JOIN email_log_labels ell ON ell.label_id = el.id
       WHERE ell.email_log_id = $1`,
      [emailLogId]
    );
    return rows.map((r: any) => r.name);
  }

  // Build label classification instruction for prompt
  buildPromptInstruction(labels: Label[]): string {
    if (!labels.length) return '';
    return `## Custom Labels\n\nClassify this email with zero or more of these labels (use exact names):\n${labels.map(l => `- "${l.name}"`).join('\n')}\n\nAdd a "labels" field to the JSON output: ["LabelName", ...]`;
  }

  private mapRow(r: any): Label {
    return { id: r.id, accountId: r.account_id, name: r.name, color: r.color, createdAt: new Date(r.created_at) };
  }
}
