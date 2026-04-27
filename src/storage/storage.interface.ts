/**
 * Universal storage contract.
 * Implementations: SQLiteStorage, PostgresStorage, InMemoryStorage (no-DB mode).
 */
export interface IStorage {
  /** Initialize schema / run migrations */
  init(): Promise<void>;

  /** Key-value style access for simple reads */
  get<T = unknown>(collection: string, id: string): Promise<T | null>;
  set<T = unknown>(collection: string, id: string, value: T): Promise<void>;
  delete(collection: string, id: string): Promise<void>;

  /** Typed query — adapter translates to SQL or in-memory filter */
  query<T = unknown>(collection: string, filter: Record<string, unknown>, opts?: QueryOpts): Promise<T[]>;
  insert<T = unknown>(collection: string, data: T): Promise<string>;
  update(collection: string, id: string, patch: Record<string, unknown>): Promise<void>;

  /** Raw access for adapters that support it (SQLite / Postgres) */
  raw?<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface QueryOpts {
  limit?:   number;
  offset?:  number;
  orderBy?: string;
  order?:   'ASC' | 'DESC';
}
