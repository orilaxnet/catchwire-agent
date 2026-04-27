#!/usr/bin/env node
/**
 * Run database migrations based on STORAGE_BACKEND env var.
 * Usage: node --loader ts-node/esm scripts/migrate.ts
 */
import { initDatabase } from '../src/storage/sqlite.adapter.ts';

const backend = process.env.STORAGE_BACKEND ?? 'sqlite';

if (backend === 'sqlite') {
  console.log('Running SQLite migrations...');
  initDatabase();
  console.log('SQLite migrations complete.');
} else if (backend === 'postgres') {
  const { PostgresStorage } = await import('../src/storage/postgres.adapter.ts');
  const storage = new PostgresStorage(process.env.POSTGRES_URL!);
  await storage.init();
  console.log('PostgreSQL migrations complete.');
} else {
  console.log(`Backend "${backend}" requires no migrations.`);
}
