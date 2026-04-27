import { randomUUID } from 'crypto';
import { Encryption } from './encryption.ts';
import { getPool } from '../storage/pg-pool.ts';
import { logger } from '../utils/logger.ts';

export class CredentialManager {
  constructor(private enc: Encryption) {}

  async storeAPIKey(accountId: string, apiKey: string): Promise<void> {
    if (!apiKey?.trim()) throw new Error('API key cannot be empty');
    const encrypted = this.enc.encrypt(apiKey);
    await getPool().query(
      'UPDATE personas SET llm_api_key_enc = $1 WHERE account_id = $2',
      [encrypted, accountId]
    );
    logger.info('API key stored', { accountId });
  }

  async getAPIKey(accountId: string): Promise<string> {
    const { rows } = await getPool().query(
      'SELECT llm_api_key_enc FROM personas WHERE account_id = $1', [accountId]
    );
    const enc = rows[0]?.llm_api_key_enc;
    if (!enc) throw new Error('No API key configured');
    return this.enc.decrypt(enc);
  }

  async storeEmailCredentials(accountId: string, creds: object): Promise<void> {
    const encrypted = this.enc.encrypt(JSON.stringify(creds));
    await getPool().query(
      'UPDATE email_accounts SET credentials_enc = $1 WHERE id = $2',
      [encrypted, accountId]
    );
  }

  async getEmailCredentials<T = Record<string, unknown>>(accountId: string): Promise<T> {
    const { rows } = await getPool().query(
      'SELECT credentials_enc FROM email_accounts WHERE id = $1', [accountId]
    );
    const enc = rows[0]?.credentials_enc;
    if (!enc) throw new Error('No credentials stored');
    return JSON.parse(this.enc.decrypt(enc)) as T;
  }

  async revokeAll(userId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE personas SET llm_api_key_enc = NULL
       WHERE account_id IN (SELECT id FROM email_accounts WHERE user_id = $1)`,
      [userId]
    );
    await pool.query(
      'UPDATE email_accounts SET credentials_enc = NULL WHERE user_id = $1',
      [userId]
    );
    await pool.query(
      `INSERT INTO audit_log (id, user_id, action) VALUES ($1, $2, 'credentials_revoked')`,
      [randomUUID(), userId]
    );
    logger.info('All credentials revoked', { userId });
  }
}
