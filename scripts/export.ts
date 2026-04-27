#!/usr/bin/env node
/**
 * Export all data from the current storage backend to JSON.
 * Usage: node --loader ts-node/esm scripts/export.ts > export.json
 *        node --loader ts-node/esm scripts/export.ts --format json --output ./backup.json
 */
import { writeFileSync } from 'fs';
import { initDatabase, getDB } from '../src/storage/sqlite.adapter.ts';

const args   = process.argv.slice(2);
const outArg = args.indexOf('--output');
const outFile = outArg !== -1 ? args[outArg + 1] : null;

const backend = process.env.STORAGE_BACKEND ?? 'sqlite';

if (backend !== 'sqlite') {
  console.error(`Export currently only supports sqlite backend (got: ${backend})`);
  process.exit(1);
}

initDatabase();
const db = getDB();

const TABLES = [
  'users',
  'email_accounts',
  'personas',
  'email_logs',
  'feedback',
  'email_threads',
  'thread_messages',
  'email_templates',
  'follow_ups',
  'scheduled_emails',
];

const exported: Record<string, unknown[]> = {};

for (const table of TABLES) {
  try {
    exported[table] = db.prepare(`SELECT * FROM ${table}`).all();
    console.error(`Exported ${exported[table].length} rows from ${table}`);
  } catch {
    console.error(`Skipping ${table} (table may not exist yet)`);
    exported[table] = [];
  }
}

const json = JSON.stringify({ exportedAt: new Date().toISOString(), backend, data: exported }, null, 2);

if (outFile) {
  writeFileSync(outFile, json, 'utf-8');
  console.error(`Saved to ${outFile}`);
} else {
  process.stdout.write(json);
}
