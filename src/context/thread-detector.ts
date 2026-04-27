import { randomUUID } from 'crypto';
import { getPool } from '../storage/pg-pool.ts';
import type { ParsedEmail } from '../types/index.ts';

export class ThreadDetector {
  async detectOrCreate(email: ParsedEmail): Promise<string> {
    const pool = getPool();
    const refs    = email.references?.filter(Boolean) ?? [];
    const replyTo = email.inReplyTo;

    for (const ref of [replyTo, ...refs]) {
      if (!ref) continue;
      const { rows } = await pool.query(
        `SELECT thread_id FROM email_log WHERE id = $1 OR from_address = $1 LIMIT 1`, [ref]
      );
      if (rows[0]?.thread_id) return this.touchThread(rows[0].thread_id);
    }

    const normalSubject = this.normalizeSubject(email.subject);
    const { rows: bySubj } = await pool.query(
      `SELECT thread_id FROM email_log
       WHERE account_id = $1
         AND LOWER(REGEXP_REPLACE(subject, '^(Re|Fwd|FW|AW|SV):\\s*', '', 'gi')) = LOWER($2)
         AND processed_at > NOW() - INTERVAL '14 days'
       ORDER BY processed_at DESC LIMIT 1`,
      [email.accountId, normalSubject]
    );
    if (bySubj[0]?.thread_id) return this.touchThread(bySubj[0].thread_id);

    return this.createThread(email);
  }

  private normalizeSubject(subject: string): string {
    return subject.replace(/^(Re|Fwd|FW|AW|SV):\s*/gi, '').replace(/\[External\]/gi, '').trim().toLowerCase();
  }

  private async touchThread(threadId: string): Promise<string> {
    await getPool().query(
      `UPDATE threads SET last_message_at = NOW(), message_count = message_count + 1, updated_at = NOW() WHERE id = $1`,
      [threadId]
    );
    return threadId;
  }

  private async createThread(email: ParsedEmail): Promise<string> {
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO threads (id, account_id, subject, participants, message_count, status, first_message_at, last_message_at)
       VALUES ($1,$2,$3,$4,1,'active',NOW(),NOW())`,
      [id, email.accountId, email.subject, JSON.stringify([email.originalSender, email.recipientEmail])]
    );
    return id;
  }
}
