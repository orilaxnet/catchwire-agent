import type { IStorage, QueryOpts } from './storage.interface.ts';
import { logger } from '../utils/logger.ts';

/**
 * Redis adapter — used as a cache/session layer alongside a primary store.
 * Implements IStorage using Redis hashes + sorted sets.
 * TTL-based expiry optional per collection.
 */
export class RedisStorage implements IStorage {
  private client: any;

  constructor(
    private url: string,
    private ttlSeconds?: number,
  ) {}

  async init(): Promise<void> {
    const { createClient } = await import('redis' as any);
    this.client = createClient({ url: this.url });
    this.client.on('error', (err: unknown) => logger.error('Redis error', { err }));
    await this.client.connect();
    logger.info('RedisStorage initialized');
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const raw = await this.client.hGet(this.key(collection), id);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set<T>(collection: string, id: string, value: T): Promise<void> {
    await this.client.hSet(this.key(collection), id, JSON.stringify(value));
    if (this.ttlSeconds) {
      await this.client.expire(this.key(collection), this.ttlSeconds);
    }
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.client.hDel(this.key(collection), id);
  }

  async query<T>(collection: string, filter: Record<string, unknown>, opts?: QueryOpts): Promise<T[]> {
    const all = await this.client.hGetAll(this.key(collection));
    let results: T[] = Object.values(all).map((v: any) => JSON.parse(v) as T);

    for (const [k, v] of Object.entries(filter)) {
      results = results.filter((item) => (item as any)[k] === v);
    }

    if (opts?.orderBy) {
      const f   = opts.orderBy;
      const dir = opts.order === 'DESC' ? -1 : 1;
      results.sort((a, b) => {
        const av = (a as any)[f], bv = (b as any)[f];
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }

    if (opts?.offset) results = results.slice(opts.offset);
    if (opts?.limit)  results = results.slice(0, opts.limit);

    return results;
  }

  async insert<T = unknown>(collection: string, data: T): Promise<string> {
    const { randomUUID } = await import('crypto');
    const id = (data as any).id ?? randomUUID();
    await this.set(collection, id, { ...data, id });
    return id;
  }

  async update(collection: string, id: string, patch: Record<string, unknown>): Promise<void> {
    const existing = await this.get<object>(collection, id);
    await this.set(collection, id, { ...(existing ?? {}), ...patch, id });
  }

  private key(collection: string): string {
    return `email_agent:${collection}`;
  }
}
