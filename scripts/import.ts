#!/usr/bin/env node
/**
 * Import data from a JSON export file into the current storage backend.
 * Usage: node --loader ts-node/esm scripts/import.ts --file ./backup.json
 *
 * WARNING: This does NOT wipe existing data first. Use --clean to truncate tables before import.
 */
import { readFileSync } from 'fs';
import { initDatabase, getDB } from '../src/storage/sqlite.adapter.ts';

const args      = process.argv.slice(2);
const fileArg   = args.indexOf('--file');
const cleanFlag = args.includes('--clean');

if (fileArg === -1 || !args[fileArg + 1]) {
  console.error('Usage: import.ts --file <path> [--clean]');
  process.exit(1);
}

const filePath = args[fileArg + 1];
const raw      = readFileSync(filePath, 'utf-8');
const { data } = JSON.parse(raw) as { exportedAt: string; data: Record<string, any[]> };

const backend = process.env.STORAGE_BACKEND ?? 'sqlite';
if (backend !== 'sqlite') {
  console.error(`Import currently only supports sqlite backend (got: ${backend})`);
  process.exit(1);
}

initDatabase();
const db = getDB();

for (const [table, rows] of Object.entries(data)) {
  if (!rows.length) continue;

  if (cleanFlag) {
    try { db.prepare(`DELETE FROM ${table}`).run(); } catch { /* skip */ }
  }

  const cols        = Object.keys(rows[0]);
  const placeholders = cols.map(() => '?').join(', ');
  const stmt        = db.prepare(
    `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`
  );

  const insertMany = db.transaction((rowList: any[]) => {
    for (const row of rowList) {
      stmt.run(...cols.map((c) => row[c]));
    }
  });

  try {
    insertMany(rows);
    console.log(`Imported ${rows.length} rows into ${table}`);
  } catch (err) {
    console.error(`Failed to import ${table}:`, err);
  }
}

console.log('Import complete.');
