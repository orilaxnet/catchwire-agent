import { randomUUID } from 'crypto';
import type { IStorage, QueryOpts } from './storage.interface.ts';

/**
 * In-memory storage — zero dependencies, zero persistence.
 * Useful for testing, ephemeral deployments, or "no-database" mode.
 * Data is lost on process restart.
 */
export class InMemoryStorage implements IStorage {
  private store = new Map<string, Map<string, unknown>>();

  async init(): Promise<void> {
    // nothing to initialize
  }

  private col(collection: string): Map<string, unknown> {
    if (!this.store.has(collection)) {
      this.store.set(collection, new Map());
    }
    return this.store.get(collection)!;
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    return (this.col(collection).get(id) as T) ?? null;
  }

  async set<T>(collection: string, id: string, value: T): Promise<void> {
    this.col(collection).set(id, value);
  }

  async delete(collection: string, id: string): Promise<void> {
    this.col(collection).delete(id);
  }

  async query<T>(collection: string, filter: Record<string, unknown>, opts?: QueryOpts): Promise<T[]> {
    let results = [...this.col(collection).values()] as T[];

    for (const [key, value] of Object.entries(filter)) {
      results = results.filter((item) => (item as any)[key] === value);
    }

    if (opts?.orderBy) {
      const field = opts.orderBy;
      const dir   = opts.order === 'DESC' ? -1 : 1;
      results.sort((a, b) => {
        const av = (a as any)[field];
        const bv = (b as any)[field];
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }

    if (opts?.offset) results = results.slice(opts.offset);
    if (opts?.limit)  results = results.slice(0, opts.limit);

    return results;
  }

  async insert<T = unknown>(collection: string, data: T): Promise<string> {
    const id = (data as any).id ?? randomUUID();
    this.col(collection).set(id, { ...(data as object), id });
    return id;
  }

  async update(collection: string, id: string, patch: Record<string, unknown>): Promise<void> {
    const existing = this.col(collection).get(id);
    if (existing) {
      this.col(collection).set(id, { ...(existing as object), ...patch });
    }
  }
}
