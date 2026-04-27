#!/usr/bin/env node
/**
 * Seeds a demo account for development / local testing.
 */
import { getDB, initDatabase } from '../src/storage/sqlite.adapter.ts';

initDatabase();
const db = getDB();

const accountId = 'demo-account-1';
const userId    = 'demo-user-1';

db.prepare(`INSERT OR IGNORE INTO users (id, telegram_id, name) VALUES (?, ?, ?)`).run(userId, '0', 'Demo User');
db.prepare(`INSERT OR IGNORE INTO personas (account_id) VALUES (?)`).run(accountId);
db.prepare(`
  INSERT OR IGNORE INTO email_accounts (id, user_id, email_address, provider)
  VALUES (?, ?, ?, ?)
`).run(accountId, userId, 'demo@example.com', 'smtp');

console.log('Seed complete. Demo account:', accountId);
