/**
 * Database layer — PostgreSQL via pg.
 * Keeps the same export names for backward compatibility.
 */

import { randomUUID } from 'crypto';
import { getPool, initPgSchema } from './pg-pool.ts';
import { logger }   from '../utils/logger.ts';
import type { User, EmailAccount, FeedbackRecord } from '../types/index.ts';

// ── Init ────────────────────────────────────────────────────────────────────

export async function initDatabase(): Promise<void> {
  await initPgSchema();
  logger.info('PostgreSQL storage initialized');
}

/** Returns the shared pool. Use pool.query() for raw SQL. */
export function getDB() {
  return getPool();
}

// ── UserRepo ─────────────────────────────────────────────────────────────────

export const UserRepo = {
  async findByTelegramId(telegramId: string): Promise<User | undefined> {
    const { rows } = await getPool().query(
      'SELECT * FROM users WHERE telegram_id = $1', [telegramId]
    );
    return rows[0] as User | undefined;
  },

  async create(telegramId: string, name: string): Promise<User> {
    const id = randomUUID();
    await getPool().query(
      'INSERT INTO users (id, telegram_id, name) VALUES ($1, $2, $3)',
      [id, telegramId, name]
    );
    return (await this.findByTelegramId(telegramId))!;
  },
};

// ── AccountRepo ───────────────────────────────────────────────────────────────

export const AccountRepo = {
  async findByUser(userId: string): Promise<EmailAccount[]> {
    const { rows } = await getPool().query(
      'SELECT * FROM email_accounts WHERE user_id = $1 ORDER BY priority', [userId]
    );
    return rows as EmailAccount[];
  },

  async create(data: { userId: string; emailAddress: string; displayName?: string; accountType: string; priority?: number }): Promise<string> {
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO email_accounts (id, user_id, email_address, display_name, account_type, enabled, priority)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
      [id, data.userId, data.emailAddress, data.displayName ?? data.emailAddress, data.accountType, data.priority ?? 5]
    );
    return id;
  },

  async logEmail(accountId: string): Promise<void> {
    await getPool().query(
      'UPDATE email_accounts SET total_emails = total_emails + 1, last_sync_at = NOW() WHERE id = $1',
      [accountId]
    );
  },
};

// ── EmailLogRepo ──────────────────────────────────────────────────────────────

export const EmailLogRepo = {
  async insert(data: {
    id: string; accountId: string; threadId?: string;
    sender: string; senderName?: string; subject?: string;
    body?: string; summary?: string; priority?: string; intent?: string;
    receivedAt?: Date; agentResponse?: string;
    parseMethod?: string; parseConfidence?: number;
    processingMs?: number; llmProvider?: string; llmModel?: string;
  }): Promise<void> {
    await getPool().query(
      `INSERT INTO email_log
         (id, account_id, thread_id, from_address, sender_name, subject, body, summary,
          priority, intent, received_at, agent_response, llm_provider, processing_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO NOTHING`,
      [
        data.id, data.accountId, data.threadId ?? null,
        data.sender, data.senderName ?? null, data.subject ?? null,
        data.body ?? null, data.summary ?? null,
        data.priority ?? 'medium', data.intent ?? null,
        data.receivedAt ?? new Date(),
        data.agentResponse ? JSON.parse(data.agentResponse) : null,
        data.llmProvider ?? null, data.processingMs ?? null,
      ]
    );
  },

  async recordAction(id: string, action: string): Promise<void> {
    await getPool().query(
      `UPDATE email_log SET user_action = $1 WHERE id = $2`, [action, id]
    );
  },
};

// ── FeedbackRepo ──────────────────────────────────────────────────────────────

export const FeedbackRepo = {
  async insert(data: Omit<FeedbackRecord, 'id'>): Promise<void> {
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO feedback (id, email_log_id, account_id, prediction, user_action, user_correction, was_correct)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id, data.emailLogId, data.accountId,
        JSON.stringify(data.prediction),
        data.userAction,
        data.userCorrection ? JSON.stringify(data.userCorrection) : null,
        data.wasCorrect ?? null,
      ]
    );
  },

  async countRecent(accountId: string, days = 30): Promise<number> {
    const safeDays = Math.max(1, Math.min(3650, Math.floor(Number(days))));
    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS cnt FROM feedback
       WHERE account_id = $1 AND created_at > NOW() - ($2 || ' days')::INTERVAL`,
      [accountId, String(safeDays)]
    );
    return rows[0]?.cnt ?? 0;
  },
};
