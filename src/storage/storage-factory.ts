import type { IStorage } from './storage.interface.ts';

export type StorageBackend = 'postgres' | 'memory';

/**
 * Creates the appropriate storage backend based on configuration.
 *
 * - 'memory'   → InMemoryStorage (no deps, ephemeral — for dev/testing)
 * - 'postgres' → PostgreSQL via pg (production-grade, requires connection string)
 */
export async function createStorage(backend: StorageBackend, connectionString?: string): Promise<IStorage> {
  switch (backend) {
    case 'memory': {
      const { InMemoryStorage } = await import('./memory.adapter.ts');
      const s = new InMemoryStorage();
      await s.init();
      return s;
    }
    case 'postgres': {
      if (!connectionString) throw new Error('DATABASE_URL required for postgres backend');
      const { PostgresStorage } = await import('./postgres.adapter.ts');
      const s = new PostgresStorage(connectionString);
      await s.init();
      return s;
    }
    default:
      throw new Error(`Unknown storage backend: ${backend}`);
  }
}
